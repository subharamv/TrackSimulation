// CSV parsing for track data.
// Primary format (left/right rail survey data):
//   Point#, Left Easting, Left Northing, Left Height, Right Easting, Right Northing, Right Height [, Type, Radius]
//
// Centre line is CALCULATED from the left/right rail coordinates — do not include it in the CSV.
// Gauge is selected in the side panel — do not include it in the CSV.
//
// Legacy centreline format is still accepted for backwards compatibility.

const HEADER_ALIASES = {
  point: ['point', 'point number', 'point #', 'point#', '#', 'no', 'number', 'pt', 'point no', 'point no.', 'point_no'],
  leftE: ['left easting', 'left_easting', 'lefte', 'l_easting', 'left rail eastings', 'left rail easting', 'le', 'left e', 'left x', 'left_x', 'lx'],
  leftN: ['left northing', 'left_northing', 'leftn', 'l_northing', 'left rail northings', 'left rail northing', 'ln', 'left n', 'left y', 'left_y', 'ly'],
  leftH: ['left height', 'left_height', 'lefth', 'l_height', 'left rail height', 'lh', 'left h', 'left z', 'left_z', 'lz'],
  rightE: ['right easting', 'right_easting', 'righte', 'r_easting', 'right rail eastings', 'right rail easting', 're', 'right e', 'right x', 'right_x', 'rx'],
  rightN: ['right northing', 'right_northing', 'rightn', 'r_northing', 'right rail northings', 'right rail northing', 'rn', 'right n', 'right y', 'right_y', 'ry'],
  rightH: ['right height', 'right_height', 'righth', 'r_height', 'right rail height', 'rh', 'right h', 'right z', 'right_z', 'rz'],
  easting: ['easting', 'eastings', 'e', 'x', 'cl e', 'cl easting', 'cl eastings', 'centreline e', 'centreline easting'],
  northing: ['northing', 'northings', 'n', 'y', 'cl n', 'cl northing', 'cl northings', 'centreline n', 'centreline northing'],
  height: ['height', 'elev', 'elevation', 'z', 'h', 'cl h', 'cl height', 'centreline h', 'centreline height'],
  chainage: ['chainage', 'chain', 'ch'],
  type: ['type', 'straight/arc', 'straight / arc', 'alignment'],
  radius: ['radius', 'rad', 'r'],
  gauge: ['gauge', 'g', 'gauge δ', 'gauge deviation', 'gauge diff'],
  cant: ['cant', 'c', 'cant δ', 'cant deviation', 'cant diff'],
  length: ['length', 'dist', 'distance', 'len'],
};

function findCol(headers, key) {
  const aliases = HEADER_ALIASES[key] || [key];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    if (aliases.includes(h)) return i;
  }
  return -1;
}

function parseNum(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Extract headers and a small data preview from raw CSV text.
 */
export function extractCSVHeaders(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 1) throw new Error('CSV file is empty.');
  const headers = lines[0].split(',').map(h => h.trim());
  const preview = lines.slice(1, 4).map(l => l.split(',').map(v => v.trim()));
  return { headers, preview, totalRows: lines.length - 1 };
}

/**
 * Auto-detect which CSV column index maps to each required field.
 * Returns a mapping object { point, leftE, leftN, leftH, rightE, rightN, rightH, type, radius }.
 */
export function autoDetectMapping(headers) {
  const mapping = {};
  for (const key of Object.keys(HEADER_ALIASES)) {
    mapping[key] = findCol(headers, key);
  }
  return mapping;
}

/**
 * Parse CSV text using a user-supplied column mapping.
 * mapping: { point, leftE, leftN, leftH, rightE, rightN, rightH, type, radius } — each value is a column index (0-based) or -1.
 */
export function parseCSVWithMapping(text, mapping) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header and at least one data row.');

  const rawPoints = [];
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim());
    if (vals.length < 2 || vals.every(v => v === '')) continue;

    const col = mapping;
    const pointNumber = col.point >= 0 ? vals[col.point] || String(i) : String(i);

    rawPoints.push({
      pointNumber,
      leftEasting:  col.leftE  >= 0 ? parseNum(vals[col.leftE])  : 0,
      leftNorthing: col.leftN  >= 0 ? parseNum(vals[col.leftN])  : 0,
      leftHeight:   col.leftH  >= 0 ? parseNum(vals[col.leftH])  : 0,
      rightEasting: col.rightE >= 0 ? parseNum(vals[col.rightE]) : 0,
      rightNorthing:col.rightN >= 0 ? parseNum(vals[col.rightN]) : 0,
      rightHeight:  col.rightH >= 0 ? parseNum(vals[col.rightH]) : 0,
      type: col.type >= 0
        ? (vals[col.type] || '').toLowerCase().includes('arc') ? 'arc' : 'straight'
        : 'straight',
      radius: col.radius >= 0 ? parseNum(vals[col.radius]) : 0,
    });
  }

  if (rawPoints.length === 0) throw new Error('No data rows found in CSV.');
  return rawPoints;
}

/**
 * Parse CSV text into an array of track point objects.
 * Detects whether the CSV uses left/right rail columns or centreline columns.
 */
export function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    throw new Error('CSV must have a header and at least one data row.');
  }

  const headers = lines[0].split(',').map(h => h.trim());
  const col = {};
  for (const key of Object.keys(HEADER_ALIASES)) {
    col[key] = findCol(headers, key);
  }

  // Detect format: if we have leftE, leftN, leftH => left/right rail format
  const isLeftRightFormat = col.leftE >= 0 && col.leftN >= 0;

  const rawPoints = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim());
    if (vals.length < 2 || vals.every(v => v === '')) continue;

    const pointNumber = col.point >= 0 ? vals[col.point] || String(i) : String(i);

    if (isLeftRightFormat) {
      // Left/right rail coordinate format
      rawPoints.push({
        pointNumber,
        leftEasting: col.leftE >= 0 ? parseNum(vals[col.leftE]) : 0,
        leftNorthing: col.leftN >= 0 ? parseNum(vals[col.leftN]) : 0,
        leftHeight: col.leftH >= 0 ? parseNum(vals[col.leftH]) : 0,
        rightEasting: col.rightE >= 0 ? parseNum(vals[col.rightE]) : 0,
        rightNorthing: col.rightN >= 0 ? parseNum(vals[col.rightN]) : 0,
        rightHeight: col.rightH >= 0 ? parseNum(vals[col.rightH]) : 0,
        type: col.type >= 0
          ? (vals[col.type] || '').toLowerCase().includes('arc') ? 'arc' : 'straight'
          : 'straight',
        radius: col.radius >= 0 ? parseNum(vals[col.radius]) : 0,
      });
    } else {
      // Centre line format — convert to left/right rail format using gauge offset
      const easting = col.easting >= 0 ? parseNum(vals[col.easting]) : 0;
      const northing = col.northing >= 0 ? parseNum(vals[col.northing]) : 0;
      const height = col.height >= 0 ? parseNum(vals[col.height]) : 0;
      const gauge = col.gauge >= 0 ? parseNum(vals[col.gauge]) : 4.85;
      const cant = col.cant >= 0 ? parseNum(vals[col.cant]) : 0;

      // We don't know the bearing at each point from centreline-only data,
      // so we compute approximate left/right offsets from the track direction
      rawPoints.push({
        pointNumber,
        easting,
        northing,
        height,
        gauge,
        cant,
        type: col.type >= 0
          ? (vals[col.type] || '').toLowerCase().includes('arc') ? 'arc' : 'straight'
          : 'straight',
        radius: col.radius >= 0 ? parseNum(vals[col.radius]) : 0,
        chainage: col.chainage >= 0 ? parseNum(vals[col.chainage]) : 0,
        length: col.length >= 0 ? parseNum(vals[col.length]) : 0,
        _isCentreline: true,
      });
    }
  }

  if (rawPoints.length === 0) {
    throw new Error('No data rows found in CSV.');
  }

  // Convert centreline-only points to left/right rail format
  if (!isLeftRightFormat) {
    return expandCentrelinePoints(rawPoints);
  }

  return rawPoints;
}

/**
 * Convert centreline-only raw points to left/right rail format
 * by computing perpendicular offsets.
 */
function expandCentrelinePoints(points) {
  return points.map((p, i) => {
    if (p.leftEasting !== undefined) return p; // already has rail coords

    const easting = p.easting;
    const northing = p.northing;
    const height = p.height;
    const gauge = p.gauge || 4.85;
    const cant = p.cant || 0;
    const halfGauge = gauge / 2;

    // Compute bearing from adjacent points
    let dx = 1, dy = 0;
    if (points.length > 1) {
      if (i === 0) {
        dx = points[1].easting - points[0].easting;
        dy = points[1].northing - points[0].northing;
      } else {
        dx = easting - points[i - 1].easting;
        dy = northing - points[i - 1].northing;
      }
    }
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > 0.0001) { dx /= len; dy /= len; }

    // Perpendicular direction
    const nx = -dy;
    const ny = dx;

    // Left rail = centre + perpendicular * halfGauge
    // Right rail = centre - perpendicular * halfGauge
    const leftHeight = height + cant / 2;
    const rightHeight = height - cant / 2;

    return {
      ...p,
      leftEasting: easting + nx * halfGauge,
      leftNorthing: northing + ny * halfGauge,
      leftHeight,
      rightEasting: easting - nx * halfGauge,
      rightNorthing: northing - ny * halfGauge,
      rightHeight,
    };
  });
}

export function exportCSV(trackData, columnKeys) {
  if (!trackData || trackData.length === 0) return null;

  const ALL_COLUMNS = [
    { key: 'pointNumber', label: 'Point#' },
    { key: 'chainage', label: 'Chainage' },
    { key: 'type', label: 'Type' },
    { key: 'leftEasting', label: 'Left E' },
    { key: 'leftNorthing', label: 'Left N' },
    { key: 'leftHeight', label: 'Left H' },
    { key: 'rightEasting', label: 'Right E' },
    { key: 'rightNorthing', label: 'Right N' },
    { key: 'rightHeight', label: 'Right H' },
    { key: 'easting', label: 'CL E' },
    { key: 'northing', label: 'CL N' },
    { key: 'height', label: 'CL H' },
    { key: 'length', label: 'Length' },
    { key: 'gauge', label: 'Gauge' },
    { key: 'cant', label: 'Cant' },
    { key: 'gaugeDiff', label: 'Gauge Diff from Standard' },
    { key: 'cantDiff', label: 'Cant Diff from Previous' },
    { key: 'radius', label: 'Radius' },
  ];

  const selectedKeys = Array.isArray(columnKeys) && columnKeys.length > 0
    ? columnKeys
    : ['pointNumber', 'leftEasting', 'leftNorthing', 'leftHeight', 'rightEasting', 'rightNorthing', 'rightHeight', 'type', 'radius'];

  const headerLabels = selectedKeys.map((key) => {
    const col = ALL_COLUMNS.find(c => c.key === key);
    if (!col) return key;
    return col.label.replace(/\s+/g, ' ').trim();
  });

  const formatByKey = (key, val) => {
    if (val === undefined || val === null) return '';
    if (typeof val === 'number') {
      if (['chainage', 'length'].includes(key)) return val.toFixed(3);
      if (['easting', 'northing', 'leftEasting', 'leftNorthing', 'rightEasting', 'rightNorthing'].includes(key)) return val.toFixed(4);
      if (['height', 'leftHeight', 'rightHeight'].includes(key)) return val.toFixed(4);
      if (['gauge', 'gaugeDiff'].includes(key)) return val.toFixed(6);
      if (['cant', 'cantDiff'].includes(key)) return val.toFixed(6);
      if (key === 'radius' && val === 0) return '∞';
      return val.toString();
    }
    return val;
  };

  const rows = trackData.map(p =>
    selectedKeys
      .map((key) => formatByKey(key, p[key]))
      .join(',')
  );

  return [headerLabels.join(','), ...rows].join('\n');
}

/**
 * Generate a blank CSV template with the required column headers.
 * Users fill in Left/Right Easting, Northing, Height per survey point.
 * Centre line and gauge calculations are done automatically in the app.
 */
export function generateTemplate() {
  const header = 'Point Number,Left Easting,Left Northing,Left Height,Right Easting,Right Northing,Right Height,Type,Radius';
  const example = '1,343086.418,6257711.316,62.860,343082.425,6257708.574,62.860,straight,0';
  return `${header}\n${example}\n`;
}

/**
 * Get sample data from the test.xlsm file (16 points).
 */
export function getSampleData() {
  return [
    { pointNumber: 1, leftEasting: 343086.417578, leftNorthing: 6257711.315974, leftHeight: 62.860301, rightEasting: 343082.424697, rightNorthing: 6257708.574208, rightHeight: 62.860312, type: 'straight', radius: 0 },
    { pointNumber: 2, leftEasting: 343083.587276, leftNorthing: 6257715.437791, leftHeight: 62.859339, rightEasting: 343079.590925, rightNorthing: 6257712.693642, rightHeight: 62.859916, type: 'arc', radius: 37620.7 },
    { pointNumber: 3, leftEasting: 343080.753075, leftNorthing: 6257719.560264, leftHeight: 62.859124, rightEasting: 343076.758397, rightNorthing: 6257716.813931, rightHeight: 62.860819, type: 'arc', radius: 16659.7 },
    { pointNumber: 4, leftEasting: 343077.920580, leftNorthing: 6257723.680453, leftHeight: 62.858879, rightEasting: 343073.923304, rightNorthing: 6257720.932455, rightHeight: 62.859045, type: 'straight', radius: 0 },
    { pointNumber: 5, leftEasting: 343075.084353, leftNorthing: 6257727.801340, leftHeight: 62.859338, rightEasting: 343071.088746, rightNorthing: 6257725.051349, rightHeight: 62.857831, type: 'straight', radius: 0 },
    { pointNumber: 6, leftEasting: 343072.253036, leftNorthing: 6257731.919524, leftHeight: 62.859137, rightEasting: 343068.256824, rightNorthing: 6257729.172054, rightHeight: 62.859364, type: 'straight', radius: 0 },
    { pointNumber: 7, leftEasting: 343069.421329, leftNorthing: 6257736.039531, leftHeight: 62.858749, rightEasting: 343065.422025, rightNorthing: 6257733.290781, rightHeight: 62.857898, type: 'arc', radius: 33193.3 },
    { pointNumber: 8, leftEasting: 343066.586137, leftNorthing: 6257740.160631, leftHeight: 62.858953, rightEasting: 343062.587839, rightNorthing: 6257737.409931, rightHeight: 62.857072, type: 'arc', radius: 49852.6 },
    { pointNumber: 9, leftEasting: 343063.751060, leftNorthing: 6257744.280129, leftHeight: 62.859371, rightEasting: 343059.755149, rightNorthing: 6257741.530109, rightHeight: 62.857805, type: 'straight', radius: 0 },
    { pointNumber: 10, leftEasting: 343060.918773, leftNorthing: 6257748.398583, leftHeight: 62.859339, rightEasting: 343056.921118, rightNorthing: 6257745.649365, rightHeight: 62.857140, type: 'straight', radius: 0 },
    { pointNumber: 11, leftEasting: 343058.081014, leftNorthing: 6257752.519149, leftHeight: 62.860178, rightEasting: 343054.089285, rightNorthing: 6257749.770131, rightHeight: 62.858766, type: 'arc', radius: 999999 },
    { pointNumber: 12, leftEasting: 343055.246416, leftNorthing: 6257756.636868, leftHeight: 62.860757, rightEasting: 343051.256582, rightNorthing: 6257753.890300, rightHeight: 62.859487, type: 'arc', radius: 38727.0 },
    { pointNumber: 13, leftEasting: 343052.415429, leftNorthing: 6257760.754670, leftHeight: 62.860541, rightEasting: 343048.422453, rightNorthing: 6257758.009489, rightHeight: 62.858720, type: 'arc', radius: 13399.2 },
    { pointNumber: 14, leftEasting: 343049.577298, leftNorthing: 6257764.875788, leftHeight: 62.861378, rightEasting: 343045.588548, rightNorthing: 6257762.128831, rightHeight: 62.858186, type: 'arc', radius: 18998.8 },
    { pointNumber: 15, leftEasting: 343046.740438, leftNorthing: 6257768.993886, leftHeight: 62.862390, rightEasting: 343042.757362, rightNorthing: 6257766.250042, rightHeight: 62.860487, type: 'arc', radius: 436.9 },
    { pointNumber: 16, leftEasting: 343046.626791, leftNorthing: 6257769.161730, leftHeight: 62.862004, rightEasting: 343042.623389, rightNorthing: 6257766.446774, rightHeight: 62.861431, type: 'arc', radius: 999999 },
  ];
}

