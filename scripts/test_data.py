#!/usr/bin/env python3
"""Offline integrity checks for the bundled aggregate snapshot."""
import collections, json, math, pathlib, tempfile, unittest
from unittest.mock import patch
import build_data
from build_data import distance
DATA=json.loads((pathlib.Path(__file__).resolve().parents[1]/'public/data/chicago-loop.json').read_text())
class SnapshotTests(unittest.TestCase):
    def test_failed_fetch_preserves_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            target=pathlib.Path(directory)/'source.json';target.write_text('[{"verified":true}]')
            def malformed_download(command,check):
                pathlib.Path(command[command.index('-o')+1]).write_text('{incomplete')
            with patch.object(build_data.subprocess,'run',side_effect=malformed_download):
                with self.assertRaises(json.JSONDecodeError):build_data.fetch('https://example.invalid',target)
            self.assertEqual(json.loads(target.read_text()),[{'verified':True}])
            self.assertEqual(list(pathlib.Path(directory).iterdir()),[target])
    def test_fixed_normalization_matches_counts(self):
        raw={}
        for c in DATA['cells']:
            n=c['total'];a=n/(n+20)
            raw[tuple(map(int,c['id'].split(':')))]=[a*4*v+(1-a)*n for v in c['counts']]
        smoothed={}
        for (x,y),values in raw.items():
            neighbors=[(x,y,.5),(x-1,y,.125),(x+1,y,.125),(x,y-1,.125),(x,y+1,.125)]
            valid=[(a,b,w) for a,b,w in neighbors if (a,b) in raw]
            smoothed[x,y]=[sum(raw[a,b][k]*w for a,b,w in valid)/sum(w for a,b,w in valid) for k in range(4)]
        positive=sorted(v for values in smoothed.values() for v in values if v>0)
        q=max(1,positive[math.ceil(len(positive)*.9)-1])
        self.assertAlmostEqual(q,DATA['manifest']['normalization'])
        for c in DATA['cells']:
            values=smoothed[tuple(map(int,c['id'].split(':')))]
            for observed,v in zip(c['intensity'],values):self.assertAlmostEqual(observed,v/(v+q))
    def test_counts_and_no_records(self):
        m=DATA['manifest'];cells=DATA['cells']
        self.assertEqual(m['sourceReportCount'],m['eligibleReportCount']+m['excludedReportCount'])
        self.assertEqual(sum(c['total'] for c in cells),m['eligibleReportCount'])
        for c in cells:
            self.assertEqual(c['total'],sum(c['counts']))
            self.assertEqual(c['counts'],c['weighted'])
            self.assertEqual(len(c['intensity']),4)
            self.assertTrue(all(0<=v<1 for v in c['intensity']))
            self.assertEqual(set(c),{'id','bounds','center','counts','weighted','intensity','total'})
        self.assertGreater(m['normalization'],0)
    def test_graph(self):
        nodes={n['id']:n['point'] for n in DATA['nodes']};adj=collections.defaultdict(set)
        self.assertEqual(len(nodes),len(DATA['nodes']))
        self.assertEqual(len({e['id'] for e in DATA['edges']}),len(DATA['edges']))
        for e in DATA['edges']:
            self.assertIn(e['from'],nodes);self.assertIn(e['to'],nodes)
            self.assertEqual(e['coordinates'][0],nodes[e['from']]);self.assertEqual(e['coordinates'][-1],nodes[e['to']])
            self.assertGreater(e['meters'],0)
            self.assertAlmostEqual(e['meters'],sum(distance(a,b) for a,b in zip(e['coordinates'],e['coordinates'][1:])),places=5)
            self.assertNotIn('alley',e['name'].lower())
            adj[e['from']].add(e['to']);adj[e['to']].add(e['from'])
        seen={next(iter(nodes))};todo=list(seen)
        while todo:
            for n in adj[todo.pop()]-seen:seen.add(n);todo.append(n)
        self.assertEqual(seen,set(nodes))
        for landmark in DATA['landmarks']:self.assertLess(min(distance(landmark['point'],p) for p in nodes.values()),75)
    def test_complete_coverage(self):
        cells=DATA['cells'];m=DATA['manifest'];w,s,e,n=m['incidentBounds']
        ids={tuple(map(int,c['id'].split(':'))) for c in cells};nx=max(x for x,y in ids)+1;ny=max(y for x,y in ids)+1
        self.assertEqual(ids,{(x,y) for x in range(nx) for y in range(ny)})
        self.assertAlmostEqual(min(c['bounds'][0] for c in cells),w)
        self.assertAlmostEqual(max(c['bounds'][2] for c in cells),e)
        self.assertAlmostEqual(min(c['bounds'][1] for c in cells),s)
        self.assertAlmostEqual(max(c['bounds'][3] for c in cells),n)
        pw,ps,pe,pn=m['planningBounds']
        self.assertGreater(distance([w,ps],[pw,ps]),500);self.assertGreater(distance([pe,ps],[e,ps]),500)
        self.assertGreater(distance([pw,s],[pw,ps]),500);self.assertGreater(distance([pw,pn],[pw,n]),500)
        for node in DATA['nodes']:
            x,y=node['point'];self.assertTrue(pw<=x<=pe and ps<=y<=pn)
            self.assertTrue(any(c['bounds'][0]<=x<=c['bounds'][2] and c['bounds'][1]<=y<=c['bounds'][3] for c in cells))
if __name__=='__main__':unittest.main()
