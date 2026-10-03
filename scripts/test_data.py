#!/usr/bin/env python3
"""Offline multi-city integrity, ingestion, cache atomicity and onboarding checks."""
import collections, copy, datetime, json, math, pathlib, tempfile, unittest
from unittest.mock import patch
import build_data as build
ROOT=pathlib.Path(__file__).resolve().parents[1]

class SnapshotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog=json.loads((ROOT/'public/data/catalog.json').read_text())
        cls.datasets=[json.loads((ROOT/'public'/a['datasetUrl'].lstrip('/')).read_text()) for a in cls.catalog['areas']]
    def test_catalog_and_packages(self):
        self.assertEqual(self.catalog['version'],1)
        self.assertEqual(self.catalog['defaultAreaId'],'nyc-manhattan')
        self.assertEqual({a['cityId'] for a in self.catalog['areas']},{'nyc','chicago'})
        for area,data in zip(self.catalog['areas'],self.datasets):
            with self.subTest(area=area['id']):
                build.validate_snapshot(data);m=data['manifest']
                self.assertEqual(m['schemaVersion'],1);self.assertEqual(m['datasetId'],area['id'])
                self.assertEqual(m['cityId'],area['cityId']);self.assertEqual(m['planningBounds'],area['bounds'])
                self.assertEqual(m['district'],area['region']);self.assertEqual(m['timezone'],area['timezone'])
                self.assertEqual(m['periodStart'],area['periodStart']);self.assertEqual(m['periodEnd'],area['periodEnd'])
                ids={p['id'] for p in data['landmarks']}
                self.assertIn(area['defaultOriginId'],ids);self.assertIn(area['defaultDestinationId'],ids)
    def test_fixed_normalization_matches_counts(self):
        for data in self.datasets:
            with self.subTest(city=data['manifest']['cityId']):
                raw={}
                for c in data['cells']:
                    n=c['total'];a=n/(n+20)
                    raw[tuple(map(int,c['id'].split(':')))]=[a*4*v+(1-a)*n for v in c['counts']]
                smoothed={}
                for (x,y),values in raw.items():
                    neighbors=[(x,y,.5),(x-1,y,.125),(x+1,y,.125),(x,y-1,.125),(x,y+1,.125)]
                    valid=[(a,b,w) for a,b,w in neighbors if (a,b) in raw]
                    smoothed[x,y]=[sum(raw[a,b][k]*w for a,b,w in valid)/sum(w for a,b,w in valid) for k in range(4)]
                positive=sorted(v for values in smoothed.values() for v in values if v>0)
                q=max(1,positive[math.ceil(len(positive)*.9)-1])
                self.assertAlmostEqual(q,data['manifest']['normalization'])
                for c in data['cells']:
                    values=smoothed[tuple(map(int,c['id'].split(':')))]
                    for observed,v in zip(c['intensity'],values):self.assertAlmostEqual(observed,v/(v+q))
    def test_counts_and_no_records(self):
        for data in self.datasets:
            m=data['manifest'];cells=data['cells']
            self.assertEqual(set(data),{'manifest','nodes','edges','cells','landmarks'})
            self.assertEqual(m['sourceReportCount'],m['eligibleReportCount']+m['excludedReportCount'])
            self.assertEqual(sum(c['total'] for c in cells),m['eligibleReportCount'])
            for c in cells:
                self.assertEqual(c['total'],sum(c['counts']));self.assertEqual(c['counts'],c['weighted'])
                self.assertEqual(len(c['intensity']),4);self.assertTrue(all(0<=v<1 for v in c['intensity']))
                self.assertEqual(set(c),{'id','bounds','center','counts','weighted','intensity','total'})
            self.assertTrue(all(weight==1 for weight in m['categoryWeights'].values()))
    def test_graph_geometry_and_connectivity(self):
        for data in self.datasets:
            nodes={n['id']:n['point'] for n in data['nodes']};adj=collections.defaultdict(set)
            self.assertEqual(len(nodes),len(data['nodes']));self.assertEqual(len({e['id'] for e in data['edges']}),len(data['edges']))
            for e in data['edges']:
                self.assertEqual(e['coordinates'][0],nodes[e['from']]);self.assertEqual(e['coordinates'][-1],nodes[e['to']])
                self.assertGreater(e['meters'],0)
                self.assertAlmostEqual(e['meters'],sum(build.distance(a,b) for a,b in zip(e['coordinates'],e['coordinates'][1:])),places=5)
                self.assertNotIn('alley',e['name'].lower());adj[e['from']].add(e['to']);adj[e['to']].add(e['from'])
            seen={next(iter(nodes))};todo=list(seen)
            while todo:
                for n in adj[todo.pop()]-seen:seen.add(n);todo.append(n)
            self.assertEqual(seen,set(nodes))
    def test_complete_halo(self):
        for data in self.datasets:
            cells=data['cells'];m=data['manifest'];w,s,e,n=m['incidentBounds']
            ids={tuple(map(int,c['id'].split(':'))) for c in cells};nx=max(x for x,y in ids)+1;ny=max(y for x,y in ids)+1
            self.assertEqual(ids,{(x,y) for x in range(nx) for y in range(ny)})
            self.assertAlmostEqual(min(c['bounds'][0] for c in cells),w);self.assertAlmostEqual(max(c['bounds'][2] for c in cells),e)
            self.assertAlmostEqual(min(c['bounds'][1] for c in cells),s);self.assertAlmostEqual(max(c['bounds'][3] for c in cells),n)
            pw,ps,pe,pn=m['planningBounds']
            # Equirectangular cells have small spherical conversion differences; nominal halo is 750m.
            for a,b in [([w,ps],[pw,ps]),([pe,ps],[e,ps]),([pw,s],[pw,ps]),([pw,pn],[pw,n])]:self.assertGreater(build.distance(a,b),740)
            self.assertTrue(all(build.inside(node['point'],m['planningBounds']) for node in data['nodes']))

class IngestionTests(unittest.TestCase):
    def setUp(self):
        self.config=build.load_config(ROOT/'scripts/fixtures/onboarding.json');self.grid=build.Grid(self.config)
    def test_csv_onboarding_and_exclusion_accounting(self):
        source=build.load_source(self.config,self.grid,ROOT)
        cells,q,exclusions,missing=build.aggregate(source['rows'],self.config,self.grid)
        self.assertEqual(source['expected'],12);self.assertEqual(sum(c['total'] for c in cells),2)
        self.assertEqual(sum(exclusions.values()),10);self.assertEqual(exclusions['duplicate ID'],1)
        self.assertEqual(exclusions['malformed occurrence timestamp'],3);self.assertEqual(exclusions['missing ID'],1)
        self.assertEqual(exclusions['invalid coordinates'],1);self.assertEqual(missing,0)
    def test_synthetic_csv_build_uses_same_package_pipeline(self):
        osm={'osm3s':{'timestamp_osm_base':'2026-01-01T00:00:00Z'},'elements':[{'type':'way','id':1,'nodes':[1,2],'geometry':[{'lon':-73.990,'lat':40.750},{'lon':-73.989,'lat':40.750}],'tags':{'highway':'footway','name':'Synthetic fixture path'}}]}
        with tempfile.TemporaryDirectory() as directory,patch.object(build,'load_osm',return_value=osm):
            data=build.build(self.config,pathlib.Path(directory));build.validate_snapshot(data)
            self.assertEqual(data['manifest']['eligibleReportCount'],2)
            self.assertEqual(data['manifest']['sourceAdapter'],'normalized_csv')
    def test_local_timestamp_validation(self):
        for bad in ['2025-02-30T03:00:00','2025-01-01T24:00:00','2025-01-01','2025-01-01T12:00:00Z','2025-03-09T02:30:00']:
            with self.subTest(value=bad),self.assertRaises(ValueError):build.parse_local(bad,'America/New_York')
        self.assertEqual(build.parse_local('2025-11-02T01:30:00','America/New_York').hour,1)
    def test_nyc_occurrence_interval_and_theft_subtype(self):
        config=build.load_config(ROOT/'configs/cities/nyc.json');grid=build.Grid(config)
        base={'cmplnt_num':'x','cmplnt_fr_dt':'2025-06-01T00:00:00','cmplnt_fr_tm':'08:00:00','ky_cd':'109','pd_cd':'415','prem_typ_desc':'STREET','longitude':'-73.99','latitude':'40.75'}
        cases=[({},1,None),({'cmplnt_to_dt':'2025-06-01T00:00:00','cmplnt_to_tm':'09:00:00'},1,None),({'cmplnt_to_dt':'2025-06-01T00:00:00','cmplnt_to_tm':'13:00:00'},0,'occurrence interval crosses time bucket'),({'cmplnt_to_tm':'09:00:00'},0,'incomplete occurrence interval'),({'cmplnt_to_dt':'2025-06-01T00:00:00','cmplnt_to_tm':'07:00:00'},0,'reversed occurrence interval'),({'pd_cd':'421'},0,'other offense subtype'),({'ky_cd':'104'},0,'other category'),({'prem_typ_desc':'RESIDENCE-HOUSE'},0,'other or missing place')]
        for change,expected,reason in cases:
            with self.subTest(change=change):
                cells,_,excluded,_=build.aggregate([{**base,**change}],config,grid)
                self.assertEqual(sum(c['total'] for c in cells),expected)
                if reason:self.assertEqual(excluded[reason],1)
    def test_complete_source_count_and_unique_ids(self):
        build.assert_complete([{'id':'1'},{'id':'2'}],2,'id')
        for rows,expected in [([{'id':'1'}],2),([{'id':'1'},{'id':'1'}],2),([{}],1)]:
            with self.assertRaises(ValueError):build.assert_complete(rows,expected,'id')
    def test_query_contains_full_halo_and_only_occurrence_year(self):
        for city in ['chicago','nyc']:
            c=build.load_config(ROOT/f'configs/cities/{city}.json');g=build.Grid(c);q=build.source_query(c,g)
            for bound in g.halo:self.assertIn(str(bound),q['where'])
            self.assertIn('2025-01-01T00:00:00',q['where']);self.assertIn('2026-01-01T00:00:00',q['where'])
            self.assertNotIn('rpt_dt',q['where'])
    def test_empty_signal_handles_zero_normalization(self):
        cells,q,_,_=build.aggregate([],self.config,self.grid)
        self.assertEqual(q,1);self.assertTrue(all(c['intensity']==[0,0,0,0] for c in cells))
    def test_config_rejects_unprovenanced_or_unsupported_source(self):
        for mutate in [lambda c:c['source'].pop('url'),lambda c:c['source'].update(adapter='unknown'),lambda c:c.update(bounds=[2,3,1,4]),lambda c:c.update(defaultOriginId='missing')]:
            c=copy.deepcopy(self.config);mutate(c)
            with tempfile.TemporaryDirectory() as directory:
                p=pathlib.Path(directory)/'config.json';p.write_text(json.dumps(c))
                with self.assertRaises(ValueError):build.load_config(p)

class CacheTests(unittest.TestCase):
    def test_failed_fetch_preserves_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory)/'source.json';target.write_text('[{"verified":true}]')
            def malformed_download(command,check):pathlib.Path(command[command.index('-o')+1]).write_text('{incomplete')
            with patch.object(build.subprocess,'run',side_effect=malformed_download):
                with self.assertRaises(json.JSONDecodeError):build.fetch('https://example.invalid',target)
            self.assertEqual(json.loads(target.read_text()),[{'verified':True}]);self.assertEqual(list(pathlib.Path(directory).iterdir()),[target])
    def test_failed_refresh_keeps_complete_source_cache(self):
        c=build.load_config(ROOT/'configs/cities/nyc.json');g=build.Grid(c);query=build.source_query(c,g);identity={'source':c['source'],'query':query,'configHash':build.digest(c)}
        with tempfile.TemporaryDirectory() as directory:
            cache=pathlib.Path(directory);target=cache/('source-'+build.digest(identity)+'.json')
            existing={'identity':identity,'rows':[{'cmplnt_num':'old'}],'expected':1}
            target.write_text(json.dumps(existing));before=target.read_bytes()
            with patch.object(build,'fetch',side_effect=[[{'count':'2'}],[{'cmplnt_num':'new'}]]):
                with self.assertRaises(ValueError):build.load_source(c,g,cache,refresh=True)
            self.assertEqual(before,target.read_bytes());self.assertEqual(list(cache.iterdir()),[target])
    def test_changed_source_count_is_rejected(self):
        c=build.load_config(ROOT/'configs/cities/nyc.json');g=build.Grid(c)
        with tempfile.TemporaryDirectory() as directory,patch.object(build,'fetch',side_effect=[[{'count':'1'}],[{'cmplnt_num':'new'}],[{'count':'2'}]]):
            with self.assertRaises(ValueError):build.load_source(c,g,pathlib.Path(directory))
            self.assertEqual(list(pathlib.Path(directory).iterdir()),[])
    def test_large_source_pagination_is_stable_and_complete(self):
        c=build.load_config(ROOT/'configs/cities/nyc.json');g=build.Grid(c);calls=[]
        def response(url,target,data=None):
            query=build.urllib.parse.parse_qs(build.urllib.parse.urlparse(url).query);calls.append(query)
            if query['$select']==['count(*)']: return [{'count':'100001'}]
            self.assertEqual(query['$order'],[':id ASC'])
            start=int(query['$offset'][0]);stop=min(100001,start+int(query['$limit'][0]))
            return [{'cmplnt_num':str(i)} for i in range(start,stop)]
        with tempfile.TemporaryDirectory() as directory,patch.object(build,'fetch',side_effect=response):
            result=build.load_source(c,g,pathlib.Path(directory))
            self.assertEqual(len(result['rows']),100001);self.assertEqual(len(calls),13)
    def test_imported_osm_rejects_partial_response(self):
        c=build.load_config(ROOT/'configs/cities/nyc.json');b=c['bounds']
        identity={'endpoint':c['osmEndpoint'],'query':f'[out:json][timeout:120];way["highway"]({b[1]},{b[0]},{b[3]},{b[2]});out geom;','bounds':b}
        with tempfile.TemporaryDirectory() as directory:
            cache=pathlib.Path(directory);p=cache/'import.json'
            for data in [{'remark':'runtime error: timeout','osm3s':{'timestamp_osm_base':'2026-01-01'}},{'elements':[]}]:
                p.write_text(json.dumps({'identity':identity,'data':data}))
                with self.assertRaises(ValueError):build.load_osm(c,cache,osm_file=p)
    def test_catalog_rejects_unselected_package_metadata_drift(self):
        c=build.load_config(ROOT/'configs/cities/chicago.json');c['periodStart']='2024-01-01'
        with self.assertRaises(ValueError):build.prepare_catalog([c],ROOT/'public/data')
    def test_cache_keys_change_with_config(self):
        c=build.load_config(ROOT/'configs/cities/nyc.json');g=build.Grid(c)
        old=build.digest({'source':c['source'],'query':build.source_query(c,g),'configHash':build.digest(c)})
        c['source']['places'].append('OTHER')
        new=build.digest({'source':c['source'],'query':build.source_query(c,g),'configHash':build.digest(c)})
        self.assertNotEqual(old,new)
    def test_atomic_publication_rejects_nonfinite_value(self):
        with tempfile.TemporaryDirectory() as directory:
            p=pathlib.Path(directory)/'snapshot.json';p.write_text('{"good":true}')
            with self.assertRaises(ValueError):build.atomic_json(p,{'bad':math.nan})
            self.assertEqual(p.read_text(),'{"good":true}');self.assertEqual(list(pathlib.Path(directory).iterdir()),[p])

if __name__=='__main__':unittest.main()
