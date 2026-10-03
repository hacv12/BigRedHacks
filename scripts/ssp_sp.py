"""Read the publisher's SSP-SP XLSX with bounded memory and report-level counting.

No spreadsheet is authored. Only required public incident fields are extracted;
addresses, personal characteristics and phone details are never retained.
"""
import collections
import datetime
import hashlib
import json
import math
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
TAG = '{' + NS['m'] + '}'
REQUIRED = {'NOME_DELEGACIA', 'ANO_BO', 'NUM_BO', 'VERSAO',
            'DATA_OCORRENCIA_BO', 'HORA_OCORRENCIA', 'DESCR_PERIODO',
            'RUBRICA', 'DESCR_CONDUTA', 'DESCR_TIPOLOCAL', 'DESCR_SUBTIPOLOCAL',
            'LATITUDE', 'LONGITUDE', 'CIDADE'}
CORE = ('DATA_OCORRENCIA_BO', 'HORA_OCORRENCIA', 'DESCR_PERIODO',
        'DESCR_TIPOLOCAL', 'DESCR_SUBTIPOLOCAL', 'LONGITUDE', 'LATITUDE', 'CIDADE')


def clean(value):
    return '' if value in ('NULL', None) else str(value).strip()


def excel_occurrence(day, fraction, period):
    """Never turn a missing time or broad publisher period into midnight."""
    if clean(period):
        raise ValueError('imprecise occurrence period')
    day, fraction = float(day), float(fraction)
    if not math.isfinite(day) or not day.is_integer() or day < 61:
        raise ValueError('invalid Excel occurrence date')
    if not math.isfinite(fraction) or not 0 <= fraction < 1:
        raise ValueError('invalid Excel occurrence time')
    seconds = round(fraction * 86400)
    if seconds >= 86400 or abs(seconds - fraction * 86400) > .001:
        raise ValueError('invalid Excel occurrence time precision')
    return (datetime.datetime(1899, 12, 30) + datetime.timedelta(days=day, seconds=seconds)).isoformat()


def workbook_rows(path, sheet_name):
    """Validate the source worksheet dimension and physical row continuity."""
    with zipfile.ZipFile(path) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        if workbook.find('m:workbookPr', NS) is not None and workbook.find('m:workbookPr', NS).get('date1904') in {'1', 'true'}:
            raise ValueError('Unsupported 1904 Excel date system')
        sheets = workbook.findall('m:sheets/m:sheet', NS)
        sheet = next((s for s in sheets if s.get('name') == sheet_name), None)
        if sheet is None:
            raise ValueError('Publisher worksheet not found')
        rid = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
        relations = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        target = next(r.get('Target') for r in relations if r.get('Id') == rid)
        if '..' in target or target.startswith('/'):
            raise ValueError('Unexpected worksheet path')
        target = 'xl/' + target
        strings = [''.join(item.itertext()) for item in ET.fromstring(archive.read('xl/sharedStrings.xml'))]
        header = None
        physical = 0
        declared = None
        with archive.open(target) as stream:
            for _, element in ET.iterparse(stream, events=['end']):
                if element.tag == TAG + 'dimension':
                    match = re.fullmatch(r'A1:[A-Z]+(\d+)', element.get('ref', ''))
                    if not match:
                        raise ValueError('Unsupported worksheet dimension')
                    declared = int(match.group(1))
                if element.tag != TAG + 'row':
                    continue
                physical += 1
                if element.get('r') != str(physical):
                    raise ValueError('Missing or reordered physical worksheet row')
                values = {}
                for cell in element:
                    column = cell.get('r', '').rstrip('0123456789')
                    if header is not None and header.get(column) not in REQUIRED:
                        continue
                    if cell.find('m:f', NS) is not None:
                        raise ValueError('Unexpected formula in source data')
                    value = cell.find('m:v', NS)
                    value = value.text if value is not None else ''
                    if cell.get('t') == 's':
                        value = strings[int(value)]
                    elif cell.get('t') == 'inlineStr':
                        value = ''.join(cell.find('m:is', NS).itertext())
                    values[column] = clean(value)
                if header is None:
                    header = values
                    if not REQUIRED.issubset(set(header.values())):
                        raise ValueError('Missing required SSP-SP columns')
                else:
                    yield {name: values.get(column, '') for column, name in header.items() if name in REQUIRED}
                # Clear the ROW, not the document root: the parser retains sheetData.
                element.clear()
        if declared is None or physical != declared:
            raise ValueError('Worksheet dimension / physical row count mismatch')


def consolidate(rows, bounds, categories, conduct_allowlist):
    """Apply publisher BO identity and latest version before spatial filtering."""
    reports = {}
    raw_count = 0
    for row in rows:
        raw_count += 1
        key = tuple(clean(row.get(k)) for k in ('NOME_DELEGACIA', 'ANO_BO', 'NUM_BO'))
        if not all(key):
            raise ValueError('SSP-SP source row missing publisher report identity')
        raw_version = clean(row.get('VERSAO'))
        if not re.fullmatch(r'\d+', raw_version):
            raise ValueError('SSP-SP source row missing numeric version')
        version = int(raw_version)
        core = tuple(clean(row.get(k)) for k in CORE)
        current = reports.get(key)
        if current is None or version > current[0]:
            current = [version, set(), set()]
            reports[key] = current
        if version == current[0]:
            current[1].add(core)
            current[2].add((clean(row.get('RUBRICA')), clean(row.get('DESCR_CONDUTA'))))
    audit = collections.Counter(rawWorksheetRows=raw_count, uniquePublisherReports=len(reports))
    result = []
    for key, (version, cores, offenses) in sorted(reports.items()):
        located = []
        for core in cores:
            try:
                x, y = float(core[5]), float(core[6])
            except ValueError:
                continue
            if math.isfinite(x) and math.isfinite(y) and bounds[0] <= x <= bounds[2] and bounds[1] <= y <= bounds[3]:
                located.append(core)
        if not located:
            audit['reportsOutsideHaloOrUnlocated'] += 1
            continue
        core = sorted(located)[0]
        # Key is an unambiguous serialization of the publisher-specified identity.
        row = {'id': json.dumps(key, ensure_ascii=False, separators=(',', ':')),
               'place': core[3], 'subplace': core[4], 'point': [core[5], core[6]],
               'time': None, 'category': None, 'sourceExclusion': None}
        if len(cores) != 1:
            row['sourceExclusion'] = 'conflicting latest-version occurrence fields'
        elif core[7] != 'S.PAULO':
            row['sourceExclusion'] = 'source city disagrees with coordinates'
        else:
            try:
                row['time'] = excel_occurrence(core[0], core[1], core[2])
            except (ValueError, OverflowError):
                row['sourceExclusion'] = 'missing or imprecise occurrence timestamp'
        relevant = sorted(category for category, conduct in offenses if category in categories and conduct in conduct_allowlist)
        if relevant:
            row['category'] = relevant[0]
        result.append(row)
    audit['reportsInHalo'] = len(result)
    audit['rawRowsBeyondDistinctReports'] = raw_count - len(reports)
    return result, dict(audit)


def read_source(path, config, bounds):
    source = config['source']
    rows, audit = consolidate(workbook_rows(path, source['worksheet']), bounds,
                              source['categories'], source['conductAllowlist'])
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return rows, {**audit, 'workbookSha256': digest.hexdigest(), 'worksheet': source['worksheet'],
                  'reportIdentity': ['NOME_DELEGACIA', 'ANO_BO', 'NUM_BO'],
                  'versionRule': 'highest numeric VERSAO; conflicting latest occurrence fields excluded',
                  'spatialRule': 'latest report has a coordinate in the complete incident halo; unlocated reports excluded'}
