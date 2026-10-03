#!/usr/bin/env python3
"""Build validated city packages. Python standard library and curl only; no raw rows ship."""
import argparse, collections, csv, datetime, hashlib, io, json, math, pathlib, re
import subprocess, tempfile, urllib.parse
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
BOUNDS = [-87.644, 41.866, -87.617, 41.891]  # legacy graph() default only
BUCKETS = ['Midnight–6 am', '6 am–noon', 'Noon–6 pm', '6 pm–midnight']
MODEL = 'brisa-250m-shrink20-cross-v2'
ADAPTERS = {'chicago_socrata', 'nyc_socrata', 'normalized_csv'}

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def atomic_json(target, value):
    target = pathlib.Path(target); target.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(prefix=target.name+'.', suffix='.part', dir=target.parent, delete=False)
    partial = pathlib.Path(handle.name)
    try:
        with handle:
            handle.write((json.dumps(value, separators=(',', ':'), allow_nan=False)+'\n').encode())
            handle.flush()
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)

def fetch(url, target, data=None):
    """A failed/malformed response never replaces a successful cache file."""
    target = pathlib.Path(target); target.parent.mkdir(parents=True, exist_ok=True)
    temporary = tempfile.NamedTemporaryFile(prefix=target.name+'.', suffix='.part', dir=target.parent, delete=False)
    temporary.close(); partial = pathlib.Path(temporary.name)
    cmd = ['curl','--user-agent','BigRedHacks-demo/0.2 (https://github.com/hacv12/BigRedHacks)',
           '--fail','--show-error','--silent','--retry','3','--retry-all-errors','--max-time','180',url,'-o',str(partial)]
    if data: cmd += ['--data-urlencode','data='+data]
    try:
        subprocess.run(cmd, check=True)
        result = json.loads(partial.read_text())
        partial.replace(target)
        return result
    finally:
        partial.unlink(missing_ok=True)

def distance(a,b):
    return 6371000*2*math.asin(min(1,math.sqrt(math.sin(math.radians(b[1]-a[1])/2)**2+math.cos(math.radians(a[1]))*math.cos(math.radians(b[1]))*math.sin(math.radians(b[0]-a[0])/2)**2)))

def valid_point(point):
    try:
        x,y = map(float, point)
        return math.isfinite(x) and math.isfinite(y) and -180<=x<=180 and -90<=y<=90
    except (TypeError, ValueError):
        return False

def inside(point, bounds):
    return bounds[0]<=point[0]<=bounds[2] and bounds[1]<=point[1]<=bounds[3]

def load_config(path):
    config = json.loads(pathlib.Path(path).read_text())
    required = ['id','cityId','city','district','region','regionCode','countryCode','timezone',
                'description','bounds','periodStart','periodEnd','source','landmarks','defaultOriginId','defaultDestinationId']
    if any(key not in config for key in required): raise ValueError('Missing required city configuration field')
    if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', config['id']): raise ValueError('Invalid dataset ID')
    b=config['bounds']
    if len(b)!=4 or not valid_point(b[:2]) or not valid_point(b[2:]) or not (b[0]<b[2] and b[1]<b[3]): raise ValueError('Invalid bounds')
    ZoneInfo(config['timezone'])
    start=datetime.date.fromisoformat(config['periodStart']); end=datetime.date.fromisoformat(config['periodEnd'])
    if end<start: raise ValueError('Invalid occurrence period')
    if config.get('cellSizeMeters',250)!=250 or config.get('haloMeters',750)<750: raise ValueError('Model requires 250m cells and at least 750m halo')
    source=config['source']
    if not isinstance(source,dict) or not isinstance(source.get('categories'),dict) or not isinstance(source.get('places'),list): raise ValueError('Source requires category mapping and place list')
    if any(not isinstance(k,str) or not isinstance(v,str) or not k or not v for k,v in source['categories'].items()) or any(not isinstance(v,str) or not v for v in source['places']): raise ValueError('Category and place allowlists must contain nonempty strings')
    if source.get('adapter') not in ADAPTERS: raise ValueError('Unsupported source adapter')
    if not source.get('name') or not source.get('url') or not source.get('categories') or not source.get('places'): raise ValueError('Source provenance and explicit category/place allowlists required')
    if source['adapter']=='normalized_csv' and not source.get('path'): raise ValueError('CSV source path required')
    if source['adapter']!='normalized_csv' and not source.get('endpoint'): raise ValueError('Socrata endpoint required')
    ids=[p['id'] for p in config['landmarks']]
    if len(ids)!=len(set(ids)) or config['defaultOriginId'] not in ids or config['defaultDestinationId'] not in ids: raise ValueError('Invalid landmark IDs/defaults')
    if any(not valid_point(p['point']) or not inside(p['point'],b) for p in config['landmarks']): raise ValueError('Landmark outside declared coverage')
    # Config paths are repository-relative, independent of invoking working directory.
    return config

class Grid:
    def __init__(self, config):
        self.bounds=config['bounds']; self.size=config.get('cellSizeMeters',250)
        latitude=config.get('gridReferenceLatitude',(self.bounds[1]+self.bounds[3])/2)
        self.stepx=self.size/(111320*math.cos(math.radians(latitude))); self.stepy=self.size/111320
        margin=math.ceil(config.get('haloMeters',750)/self.size)
        self.nx=math.ceil((self.bounds[2]-self.bounds[0])/self.stepx)+2*margin
        self.ny=math.ceil((self.bounds[3]-self.bounds[1])/self.stepy)+2*margin
        self.west=self.bounds[0]-margin*self.stepx; self.south=self.bounds[1]-margin*self.stepy
        self.halo=[self.west,self.south,self.west+self.nx*self.stepx,self.south+self.ny*self.stepy]
    def index(self, point):
        x=math.floor((point[0]-self.west)/self.stepx); y=math.floor((point[1]-self.south)/self.stepy)
        if not (0<=x<self.nx and 0<=y<self.ny): return None
        return x,y

def source_query(config, grid):
    s=config['source']; adapter=s['adapter']
    start=config['periodStart']+'T00:00:00'
    end=(datetime.date.fromisoformat(config['periodEnd'])+datetime.timedelta(days=1)).isoformat()+'T00:00:00'
    date='date' if adapter=='chicago_socrata' else 'cmplnt_fr_dt'
    location='location' if adapter=='chicago_socrata' else 'lat_lon'
    where=f"{date} >= '{start}' AND {date} < '{end}' AND within_box({location}, {grid.halo[3]}, {grid.halo[0]}, {grid.halo[1]}, {grid.halo[2]})"
    if adapter=='chicago_socrata':
        fields='id,date,primary_type,description,location_description,domestic,latitude,longitude'; key='id'
    else:
        fields='cmplnt_num,cmplnt_fr_dt,cmplnt_fr_tm,cmplnt_to_dt,cmplnt_to_tm,rpt_dt,ky_cd,ofns_desc,pd_cd,pd_desc,prem_typ_desc,loc_of_occur_desc,latitude,longitude'; key='cmplnt_num'
    return {'where':where,'select':fields,'key':key,'extraction':'single-response-up-to-100000-otherwise-system-row-id-pages'}

def assert_complete(rows, expected, key):
    ids=[r.get(key) for r in rows]
    if len(rows)!=expected or any(i is None or str(i).strip()=='' for i in ids) or len(set(map(str,ids)))!=expected:
        raise ValueError('Source count / fetched rows / unique nonempty IDs mismatch')

def load_source(config, grid, cache, refresh=False):
    source=config['source']; adapter=source['adapter']
    if adapter=='normalized_csv':
        path=pathlib.Path(source['path']);path=path if path.is_absolute() else ROOT/path
        content=path.read_bytes(); rows=list(csv.DictReader(io.StringIO(content.decode('utf-8-sig'))))
        required={'id','occurred_at','longitude','latitude','category','place'}
        header=next(csv.reader(io.StringIO(content.decode('utf-8-sig'))),[])
        if not required.issubset(header): raise ValueError('CSV requires id,occurred_at,longitude,latitude,category,place columns')
        query={'contentSha256':hashlib.sha256(content).hexdigest(),'columns':sorted(required)}
        return {'rows':rows,'expected':len(rows),'downloadedAt':datetime.datetime.fromtimestamp(path.stat().st_mtime,datetime.timezone.utc).isoformat(),'query':query,'queryHash':digest(query),'configHash':digest(config)}
    query=source_query(config,grid); identity={'source':source,'query':query,'configHash':digest(config)}
    key=digest(identity);target=cache/('source-'+key+'.json')
    if target.exists() and not refresh:
        result=json.loads(target.read_text())
        if result.get('identity')!=identity: raise ValueError('Source cache provenance mismatch')
        assert_complete(result['rows'],result['expected'],query['key'])
        return result
    # All pages and both counts are staged separately; replace good cache only after validation.
    with tempfile.TemporaryDirectory(prefix='source-stage-',dir=cache) as staging:
        def soda(params, name):
            url=source['endpoint']+'?'+urllib.parse.urlencode(params)
            return fetch(url,pathlib.Path(staging)/name)
        count_params={'$select':'count(*)','$where':query['where']}
        expected=int(soda(count_params,'before.json')[0]['count']);rows=[];page_size=10000
        print(f"{config['id']}: source count {expected}; fetching all pages", flush=True)
        if expected<=100000:
            # One complete response requires no ordering across pages; avoid an expensive
            # unindexed complaint-number sort. Never accept a truncated result.
            rows=soda({'$select':query['select'],'$where':query['where'],'$limit':100000},'all-rows.json') if expected else []
            if not isinstance(rows,list): raise ValueError('Malformed source result')
            print(f"{config['id']}: fetched {len(rows)}/{expected} source rows in one response",flush=True)
        else:
            for offset in range(0,expected,page_size):
                page=soda({'$select':query['select'],'$where':query['where'],'$order':':id ASC','$limit':page_size,'$offset':offset},f'page-{offset}.json')
                if not isinstance(page,list) or len(page)!=min(page_size,expected-offset): raise ValueError('Incomplete source page')
                rows.extend(page)
                print(f"{config['id']}: fetched {len(rows)}/{expected} source rows",flush=True)
        assert_complete(rows,expected,query['key'])
        rows.sort(key=lambda row:str(row[query['key']]))
        after=int(soda(count_params,'after.json')[0]['count'])
        if after!=expected: raise ValueError('Source changed during download; retry with a consistent snapshot')
    result={'identity':identity,'query':query,'queryHash':digest(query),'configHash':digest(config),'rows':rows,'expected':expected,'downloadedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
    atomic_json(target,result)
    return result

def parse_local(value, timezone):
    """Require a complete local naive timestamp; reject impossible civil times."""
    if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?',value): raise ValueError('Malformed local occurrence timestamp')
    dt=datetime.datetime.fromisoformat(value)
    zone=ZoneInfo(timezone)
    # Fall-back ambiguous hours remain the same bucket; spring-forward nonexistent times fail.
    roundtrip=dt.replace(tzinfo=zone).astimezone(datetime.timezone.utc).astimezone(zone).replace(tzinfo=None)
    if roundtrip!=dt: raise ValueError('Nonexistent local occurrence timestamp')
    return dt

def normalize_record(row, config):
    adapter=config['source']['adapter']
    if adapter=='chicago_socrata':
        return {'id':row.get('id'),'time':row.get('date'),'category':row.get('primary_type'),'place':row.get('location_description'),'point':[row.get('longitude'),row.get('latitude')],'domestic':row.get('domestic')}
    if adapter=='nyc_socrata':
        date=row.get('cmplnt_fr_dt',''); time=row.get('cmplnt_fr_tm','')
        return {'id':row.get('cmplnt_num'),'time':date[:10]+'T'+time if isinstance(date,str) and isinstance(time,str) else None,'category':str(row.get('ky_cd','')),'subtype':str(row.get('pd_cd','')),'place':row.get('prem_typ_desc'),'point':[row.get('longitude'),row.get('latitude')],'endDate':row.get('cmplnt_to_dt'),'endTime':row.get('cmplnt_to_tm')}
    return {'id':row.get('id'),'time':row.get('occurred_at'),'category':row.get('category'),'place':row.get('place'),'point':[row.get('longitude'),row.get('latitude')]}

def aggregate(rows, config, grid):
    counts=collections.defaultdict(lambda:[0]*4); exclusions=collections.Counter();seen=set();missing=0
    adapter=config['source']['adapter']; source=config['source']
    start=datetime.date.fromisoformat(config['periodStart']); end=datetime.date.fromisoformat(config['periodEnd'])
    for row in rows:
        r=normalize_record(row,config); ident=str(r.get('id') or '').strip()
        if not ident: exclusions['missing ID']+=1;continue
        if ident in seen: exclusions['duplicate ID']+=1;continue
        seen.add(ident)
        if any(v is None or v=='' for v in r['point']): missing+=1;exclusions['missing coordinates']+=1;continue
        if not valid_point(r['point']): exclusions['invalid coordinates']+=1;continue
        point=list(map(float,r['point'])); index=grid.index(point)
        if index is None: exclusions['outside incident halo']+=1;continue
        if r['category'] not in source['categories']: exclusions['other category']+=1;continue
        subtypes=source.get('subtypes',{}).get(r['category'])
        if subtypes is not None and r.get('subtype') not in subtypes: exclusions['other offense subtype']+=1;continue
        if adapter=='chicago_socrata' and r.get('domestic') is not False: exclusions['domestic or missing domestic flag']+=1;continue
        if r['place'] not in source['places']: exclusions['other or missing place']+=1;continue
        try:
            dt=parse_local(r['time'],config['timezone'])
            if not start<=dt.date()<=end: exclusions['outside occurrence period']+=1;continue
            if adapter=='nyc_socrata' and (r.get('endDate') or r.get('endTime')):
                if not r.get('endDate') or not r.get('endTime'): exclusions['incomplete occurrence interval']+=1;continue
                enddt=parse_local(r['endDate'][:10]+'T'+r['endTime'],config['timezone'])
                if enddt<dt: exclusions['reversed occurrence interval']+=1;continue
                # A range contained within one date and bucket can be assigned unambiguously.
                if dt.date()!=enddt.date() or dt.hour//6!=enddt.hour//6: exclusions['occurrence interval crosses time bucket']+=1;continue
        except (ValueError,TypeError): exclusions['malformed occurrence timestamp']+=1;continue
        counts[index][dt.hour//6]+=1
    activity={}
    for x in range(grid.nx):
        for y in range(grid.ny):
            c=counts[x,y]; n=sum(c);a=n/(n+20)
            activity[x,y]=[a*4*v+(1-a)*n for v in c]
    smooth={}
    for x,y in activity:
        neighbors=[(x,y,.5),(x-1,y,.125),(x+1,y,.125),(x,y-1,.125),(x,y+1,.125)]
        valid=[(a,b,w) for a,b,w in neighbors if (a,b) in activity];den=sum(w for a,b,w in valid)
        smooth[x,y]=[sum(activity[a,b][k]*w for a,b,w in valid)/den for k in range(4)]
    positive=sorted(v for c in smooth.values() for v in c if v>0)
    q=max(1,positive[math.ceil(.9*len(positive))-1]) if positive else 1
    cells=[]
    for (x,y),values in smooth.items():
        w,s=grid.west+x*grid.stepx,grid.south+y*grid.stepy;c=counts[x,y]
        cells.append(dict(id=f'{x}:{y}',center=[w+grid.stepx/2,s+grid.stepy/2],bounds=[w,s,w+grid.stepx,s+grid.stepy],counts=c,weighted=list(c),intensity=[v/(v+q) for v in values],total=sum(c)))
    return cells,q,dict(exclusions),missing
def graph(osm, bounds=None):
    bounds = bounds or BOUNDS
    nodes={}; edges=[]; excluded=collections.Counter()
    permitted={'footway','pedestrian','path','steps','living_street','residential','service','unclassified','tertiary','tertiary_link','secondary','secondary_link','primary','primary_link'}
    for w in osm['elements']:
        if w['type']!='way': continue
        t=w.get('tags',{}); h=t.get('highway','')
        reason=None
        if h not in permitted: reason='highway class'
        elif t.get('access') in {'private','no','customers','delivery','permit','destination'}: reason='restricted access'
        elif t.get('foot') in {'no','private','customers','delivery','permit','destination','use_sidepath'}: reason='restricted foot'
        elif t.get('service')=='alley' or 'alley' in t.get('name','').lower(): reason='alley'
        elif t.get('area')=='yes' or t.get('indoor')=='yes' or t.get('construction'): reason='area/indoor/construction'
        if reason: excluded[reason]+=1; continue
        coords=[[p['lon'],p['lat']] for p in w['geometry']]
        for i,(a,b) in enumerate(zip(coords,coords[1:])):
            if not inside(a, bounds) or not inside(b, bounds) or distance(a,b)<0.1: continue
            na,nb=map(str,w['nodes'][i:i+2]);nodes[na]=a;nodes[nb]=b
            if t.get('oneway:foot')=='-1': na,nb,a,b=nb,na,b,a
            edges.append(dict(id=f"{w['id']}:{i}",from_=na,to=nb,coordinates=[a,b],meters=distance(a,b),name=t.get('name', 'Walking path' if h in {'footway','path','pedestrian'} else 'Steps' if h=='steps' else 'Unnamed street'),bidirectional=t.get('oneway:foot') not in {'yes','1','true','-1'}))
    adj=collections.defaultdict(set)
    for e in edges: adj[e['from_']].add(e['to']);adj[e['to']].add(e['from_'])
    remaining=set(nodes);components=[]
    while remaining:
        todo=[remaining.pop()]; comp=set(todo)
        while todo:
            for n in adj[todo.pop()]:
                if n in remaining: remaining.remove(n);comp.add(n);todo.append(n)
        components.append(comp)
    if not components: raise ValueError("No usable walking graph in planning bounds")
    keep=max(components,key=len)
    edges=[{('from' if k=='from_' else k):v for k,v in e.items()} for e in edges if e['from_'] in keep]
    return [dict(id=k,point=v) for k,v in nodes.items() if k in keep],edges,dict(excluded),len(components)

def load_osm(config, cache, refresh=False, osm_file=None):
    b=config['bounds'];query=f'[out:json][timeout:120];way["highway"]({b[1]},{b[0]},{b[3]},{b[2]});out geom;'
    endpoint=config.get('osmEndpoint','https://overpass-api.de/api/interpreter')
    identity={'endpoint':endpoint,'query':query,'bounds':b};target=cache/('osm-'+digest(identity)+'.json')
    if osm_file:
        wrapped=json.loads(pathlib.Path(osm_file).read_text())
        if wrapped.get('identity')!=identity: raise ValueError('--osm-file must be a matching provenance-wrapped OSM cache')
        osm=wrapped['data']
    elif target.exists() and not refresh:
        wrapped=json.loads(target.read_text())
        if wrapped.get('identity')!=identity: raise ValueError('OSM cache provenance mismatch')
        osm=wrapped['data']
    else:
        with tempfile.TemporaryDirectory(prefix='osm-stage-',dir=cache) as staging:
            osm=fetch(endpoint,pathlib.Path(staging)/'osm.json',query)
        if osm.get('remark'): raise ValueError('Overpass reported an incomplete response: '+osm['remark'])
        if not osm.get('osm3s',{}).get('timestamp_osm_base'): raise ValueError('OSM response lacks source timestamp')
        graph(osm,b)  # fail before replacing a good cache
        atomic_json(target,{'identity':identity,'data':osm})
    if osm.get('remark'): raise ValueError('Overpass reported an incomplete response: '+osm['remark'])
    if not osm.get('osm3s',{}).get('timestamp_osm_base'): raise ValueError('OSM response lacks source timestamp')
    return osm

def validate_snapshot(data):
    m=data['manifest']; nodes={n['id']:n['point'] for n in data['nodes']};edges=data['edges'];cells=data['cells']
    if m.get('schemaVersion')!=1 or not m.get('datasetId') or not m.get('cityId') or not m.get('sourceName') or m.get('sourceAdapter') not in ADAPTERS: raise ValueError('Unsupported/incomplete package metadata')
    if not nodes or not edges or len(nodes)!=len(data['nodes']): raise ValueError('Empty/duplicate graph')
    if len({e['id'] for e in edges})!=len(edges): raise ValueError('Duplicate edge IDs')
    if m['sourceReportCount']!=m['eligibleReportCount']+m['excludedReportCount'] or sum(c['total'] for c in cells)!=m['eligibleReportCount']: raise ValueError('Aggregate count mismatch')
    if m['eligibleReportCount']<=0: raise ValueError('No eligible reports: refusing misleading empty package')
    if any(not valid_point(p) or not inside(p,m['planningBounds']) for p in nodes.values()): raise ValueError('Graph point outside coverage')
    for edge in edges:
        if edge['from'] not in nodes or edge['to'] not in nodes or edge['meters']<=0 or not math.isfinite(edge['meters']): raise ValueError('Invalid graph edge')
        if edge['coordinates'][0]!=nodes[edge['from']] or edge['coordinates'][-1]!=nodes[edge['to']]: raise ValueError('Broken edge geometry')
    if len({c['id'] for c in cells})!=len(cells): raise ValueError('Duplicate aggregate cells')
    indices={tuple(map(int,c['id'].split(':'))) for c in cells}
    if not indices: raise ValueError('Missing aggregate coverage')
    nx=max(x for x,y in indices)+1;ny=max(y for x,y in indices)+1
    if indices!={(x,y) for x in range(nx) for y in range(ny)}: raise ValueError('Incomplete grid coverage')
    actual=[min(c['bounds'][0] for c in cells),min(c['bounds'][1] for c in cells),max(c['bounds'][2] for c in cells),max(c['bounds'][3] for c in cells)]
    if any(abs(a-b)>1e-8 for a,b in zip(actual,m['incidentBounds'])): raise ValueError('Grid/incident bounds mismatch')
    w,s,e,n=m['incidentBounds'];pw,ps,pe,pn=m['planningBounds']
    if min(distance(a,b) for a,b in [([w,ps],[pw,ps]),([pe,ps],[e,ps]),([pw,s],[pw,ps]),([pw,pn],[pw,n])])<740: raise ValueError('Insufficient incident halo')
    for cell in cells:
        if cell['total']!=sum(cell['counts']) or cell['weighted']!=cell['counts'] or any(not 0<=v<1 for v in cell['intensity']): raise ValueError('Invalid aggregate cell')
    if any(not inside(p['point'],m['planningBounds']) or min(distance(p['point'],v) for v in nodes.values())>.01 for p in data['landmarks']): raise ValueError('Landmark is not snapped to graph')
    # Serialization checks all derived values for NaN/Infinity before publication.
    json.dumps(data,allow_nan=False)

def build(config, cache, refresh=False, osm_file=None):
    cache.mkdir(parents=True,exist_ok=True); grid=Grid(config)
    source=load_source(config,grid,cache,refresh)
    cells,q,exclusions,missing=aggregate(source['rows'],config,grid)
    print(f"{config['id']}: {sum(c['total'] for c in cells)} eligible reports; downloading walking graph",flush=True)
    osm=load_osm(config,cache,refresh,osm_file)
    nodes,edges,graph_exclusions,components=graph(osm,config['bounds'])
    landmarks=[];snaps=[]
    for landmark in config['landmarks']:
        point=min(nodes,key=lambda n:distance(n['point'],landmark['point']))['point'];d=distance(point,landmark['point'])
        if d>75: raise ValueError(f"{landmark['name']} landmark snap too far: {d:.1f}m")
        landmarks.append({**landmark,'point':point});snaps.append(f"{landmark['name']}: {d:.1f}m")
    adapter=config['source']['adapter'];eligible=sum(c['total'] for c in cells)
    notes=[
        'Historical reported activity, not a probability of harm. Zero reports does not mean safe.',
        f"Occurrence timestamps are local wall time in {config['timezone']}; no UTC conversion. Invalid dates/times and nonexistent DST times are excluded.",
        'All source categories fetched in the full incident halo; category/place allowlists applied after download. Equal weights; independently normalized within each package, not comparable between cities.',
        'Included source categories: '+json.dumps(config['source']['categories'],sort_keys=True)+'; subtype allowlists: '+json.dumps(config['source'].get('subtypes',{}),sort_keys=True)+'; premises: '+', '.join(config['source']['places'])+'.',
        'Spatial queries exclude unlocated records. missingCoordinateCount covers fetched rows only, not citywide missing locations.',
        '250m approximate local metric grid with at least 750m source halo; shrink20, cross smoothing .5 center/.125 cardinal; fixed nearest-rank p90 positive-activity normalization per package.',
        'All halo cells bundled including zeros; outer halo smoothing renormalizes available neighbors. Planning area has full surrounding smoothing support.',
        'OSM way-level walking tags are not a sidewalk/crosswalk/accessibility audit; node barrier/access tags are not retrieved. Largest undirected component retained; directed reachability is checked by routing.',
        'OpenStreetMap contributors, ODbL 1.0; https://www.openstreetmap.org/copyright',
        'Landmarks are nearby graph access points, not verified entrances. Snaps: '+'; '.join(snaps),
        'Exclusions (first matching rule): '+json.dumps(exclusions,sort_keys=True),
        'OSM excluded ways: '+json.dumps(graph_exclusions,sort_keys=True),
        f'Kept largest of {components} undirected graph components.',
        'Source query: '+json.dumps(source['query'],sort_keys=True),
        'Source query SHA256: '+source['queryHash']+'; configuration SHA256: '+digest(config),
    ]
    if adapter=='chicago_socrata': notes.append('Chicago requires domestic=false; missing domestic flags fail eligibility. Outdoor park, waterfront, bridge and curbside bus stop premises are eligible; transit interiors are excluded.')
    elif adapter=='nyc_socrata': notes.extend([
        'NYPD complaints use their most serious offense; occurrence-year filtering is independent of report year. Historic release contains reports through the end of 2025, so later-reported 2025 occurrences may be absent.',
        'NYPD provides no domestic/stranger relationship flag here. Outdoor premises do not establish a random encounter or pedestrian victim. Source-specific offense/premise filters differ from Chicago.',
        'NYPD occurrence intervals are assigned only when both endpoints share one date and six-hour bucket; incomplete, reversed, or cross-bucket intervals are excluded.',
        'NYPD coordinates are approximate midblock/intersection positions. Rape/sex offenses are relocated to precinct station houses and excluded. Other un-geocodable complaints can also be placed at station houses; the source has no reliable fallback-location flag, so residual spatial bias remains.',
        'Park/beach incidents may be geocoded to bordering streets. This index must not identify exact addresses, crime locations, or individual people.',
        'Official NYPD footnotes: https://data.cityofnewyork.us/api/views/qgea-i56i/files/b21ec89f-4d7b-494e-b2e9-f69ae7f4c228?download=true',
    ])
    else: notes.extend(['Normalized CSV uses publisher-defined category and place allowlists. No domestic flag is inferred; validate source-specific relevance before publication.', 'CSV content SHA256: '+source['query']['contentSha256']])
    manifest=dict(schemaVersion=1,datasetId=config['id'],cityId=config['cityId'],sourceName=config['source']['name'],sourceAdapter=adapter,
        coverageDescription=config['description'],city=config['city'],district=config['district'],timezone=config['timezone'],
        periodStart=config['periodStart'],periodEnd=config['periodEnd'],downloadedAt=source['downloadedAt'],sourceUrl=config['source']['url'],
        osmSourceUrl=config.get('osmEndpoint','https://overpass-api.de/api/interpreter'),osmTimestamp=osm['osm3s']['timestamp_osm_base'],
        planningBounds=config['bounds'],incidentBounds=grid.halo,cellSizeMeters=grid.size,sourceReportCount=source['expected'],eligibleReportCount=eligible,
        excludedReportCount=source['expected']-eligible,missingCoordinateCount=missing,categoryWeights={c:1 for c in config['source']['categories'].values()},
        timeBuckets=BUCKETS,modelVersion=MODEL,normalization=q,notes=notes)
    result=dict(manifest=manifest,nodes=nodes,edges=edges,cells=cells,landmarks=landmarks)
    validate_snapshot(result)
    print(json.dumps({'dataset':config['id'],'source':source['expected'],'eligible':eligible,'excluded':exclusions,'nodes':len(nodes),'edges':len(edges),'cells':len(cells),'normalization':q,'bytes':len(json.dumps(result,separators=(',',':')))},indent=2),flush=True)
    return result

def coverage(config):
    return dict(id=config['id'],cityId=config['cityId'],city=config['city'],region=config['district'],regionCode=config['regionCode'],countryCode=config['countryCode'],timezone=config['timezone'],bounds=config['bounds'],datasetUrl='/data/'+config['id']+'.json',defaultOriginId=config['defaultOriginId'],defaultDestinationId=config['defaultDestinationId'],description=config['description'],periodStart=config['periodStart'],periodEnd=config['periodEnd'])

def prepare_catalog(configs, output, staged=None):
    staged=staged or {};areas=[]
    for c in configs:
        p=output/(c['id']+'.json')
        if c['id'] not in staged and not p.exists(): continue
        data=staged.get(c['id']) or json.loads(p.read_text());validate_snapshot(data);m=data['manifest']
        expected={'datasetId':c['id'],'cityId':c['cityId'],'city':c['city'],'district':c['district'],'timezone':c['timezone'],'planningBounds':c['bounds'],'periodStart':c['periodStart'],'periodEnd':c['periodEnd'],'coverageDescription':c['description'],'sourceName':c['source']['name'],'sourceAdapter':c['source']['adapter'],'sourceUrl':c['source']['url']}
        if any(m.get(key)!=value for key,value in expected.items()): raise ValueError('Catalog/package metadata mismatch for '+c['id']+'; rebuild that package')
        ids={p['id'] for p in data['landmarks']}
        if c['defaultOriginId'] not in ids or c['defaultDestinationId'] not in ids: raise ValueError('Catalog defaults missing from package')
        areas.append(coverage(c))
    if not areas: raise ValueError('No validated packages to catalog')
    ids=[a['id'] for a in areas]
    if len(ids)!=len(set(ids)): raise ValueError('Duplicate catalog IDs')
    return {'version':1,'defaultAreaId':'nyc-manhattan' if 'nyc-manhattan' in ids else ids[0],'areas':areas}

def write_catalog(configs, output):
    atomic_json(output/'catalog.json',prepare_catalog(configs,output))


def import_legacy_chicago(config, grid, cache, directory):
    """Explicit migration of the already published, count-verified Chicago baseline."""
    if config['cityId']!='chicago' or config['source']['adapter']!='chicago_socrata': raise ValueError('Legacy import only supports Chicago baseline')
    baseline=json.loads((ROOT/'public/data/chicago-loop.json').read_text());m=baseline['manifest']
    if (config['bounds']!=m['planningBounds'] or grid.halo!=m['incidentBounds'] or config['periodStart']!=m['periodStart'] or config['periodEnd']!=m['periodEnd'] or config['source']['url']!=m['sourceUrl']):
        raise ValueError('Legacy source query does not match published source/period/halo metadata')
    legacy=pathlib.Path(directory);expected=int(json.loads((legacy/'count.json').read_text())[0]['count']);rows=[]
    for offset in range(0,expected,50000): rows.extend(json.loads((legacy/f'rows-{offset}.json').read_text()))
    assert_complete(rows,expected,'id')
    if expected!=m['sourceReportCount']: raise ValueError('Legacy count differs from verified published baseline')
    for row in rows:
        if not valid_point([row.get('longitude'),row.get('latitude')]) or not inside(list(map(float,[row['longitude'],row['latitude']])),grid.halo): raise ValueError('Legacy row outside source query')
        dt=datetime.datetime.fromisoformat(row['date'])
        if not config['periodStart']<=dt.date().isoformat()<=config['periodEnd']: raise ValueError('Legacy date outside source query')
    cells,q,_,_=aggregate(rows,config,grid)
    if cells!=baseline['cells'] or q!=m['normalization']: raise ValueError('Legacy aggregation differs from published baseline')
    query=source_query(config,grid);identity={'source':config['source'],'query':query,'configHash':digest(config)}
    atomic_json(cache/('source-'+digest(identity)+'.json'),{'identity':identity,'query':query,'queryHash':digest(query),'configHash':digest(config),'rows':rows,'expected':expected,'downloadedAt':m['downloadedAt']})
    osm=json.loads((legacy/'osm.json').read_text());nodes,edges,_,_=graph(osm,config['bounds'])
    if nodes!=baseline['nodes'] or edges!=baseline['edges'] or osm['osm3s']['timestamp_osm_base']!=m['osmTimestamp']: raise ValueError('Legacy graph differs from published baseline')
    b=config['bounds'];query=f'[out:json][timeout:120];way["highway"]({b[1]},{b[0]},{b[3]},{b[2]});out geom;'
    identity={'endpoint':config.get('osmEndpoint','https://overpass-api.de/api/interpreter'),'query':query,'bounds':b}
    atomic_json(cache/('osm-'+digest(identity)+'.json'),{'identity':identity,'data':osm})


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    group=ap.add_mutually_exclusive_group();group.add_argument('--city',help='city ID or package ID (default: chicago)');group.add_argument('--all',action='store_true');group.add_argument('--config',help='configuration JSON path')
    ap.add_argument('--import-legacy-chicago-cache',help='explicitly verify/migrate original Chicago cache against bundled baseline');ap.add_argument('--list',action='store_true');ap.add_argument('--cache',default=str(ROOT/'.data-cache'));ap.add_argument('--osm-file',help='matching provenance-wrapped OSM cache');ap.add_argument('--refresh',action='store_true');ap.add_argument('--output-dir',default=str(ROOT/'public/data'))
    args=ap.parse_args();configs=[load_config(p) for p in sorted((ROOT/'configs/cities').glob('*.json'))]
    if args.list:
        print('\n'.join(f"{c['cityId']}: {c['id']} — {c['description']}" for c in configs));return
    if args.config:
        custom=load_config(args.config);selected=[custom];configs=[c for c in configs if c['id']!=custom['id']]+[custom]
    elif args.all: selected=configs
    else:
        city=args.city or 'chicago';selected=[c for c in configs if city in {c['cityId'],c['id']}]
        if not selected: ap.error('Unknown city; use --list or --config')
    if args.osm_file and len(selected)!=1: ap.error('--osm-file requires one selected package')
    if args.import_legacy_chicago_cache:
        if len(selected)!=1 or args.refresh: ap.error('Legacy import requires one Chicago package and no --refresh')
        cache=pathlib.Path(args.cache);cache.mkdir(parents=True,exist_ok=True)
        import_legacy_chicago(selected[0],Grid(selected[0]),cache,args.import_legacy_chicago_cache)
    # All requested packages are built and validated before replacing any published snapshot.
    results=[(c,build(c,pathlib.Path(args.cache),args.refresh,args.osm_file)) for c in selected]
    output=pathlib.Path(args.output_dir);output.mkdir(parents=True,exist_ok=True)
    catalog=prepare_catalog(configs,output,{c['id']:data for c,data in results})
    for c,data in results: atomic_json(output/(c['id']+'.json'),data)
    atomic_json(output/'catalog.json',catalog)

if __name__=='__main__': main()
