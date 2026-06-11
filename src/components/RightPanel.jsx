import { GAUGE_TYPES } from '../utils/geometry';

export default function RightPanel({
  visible,
  trackName, onTrackNameChange,
  startChainage, onStartChainageChange,
  newPoint, onNewPointChange,
  onAddPoint,
  onExportData,
  onClearData,
  gaugeTypeId, onGaugeTypeChange,
  designGauge,
}) {
  if (!visible) return null;

  const handleChange = (field, value) => {
    onNewPointChange(prev => ({ ...prev, [field]: value }));
  };

  return (
    <div className="right-panel" id="inputPanel">
      <div className="panel-section">
        <div className="section-title">
          <span className="material-icons" style={{ fontSize: 14 }}>settings</span>
          Track Parameters
        </div>
        <div className="input-group">
          <label>Track Name</label>
          <input
            type="text"
            value={trackName}
            onChange={(e) => onTrackNameChange(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Start Chainage</label>
          <input
            type="number"
            value={startChainage}
            step="0.1"
            onChange={(e) => onStartChainageChange(parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="input-group">
          <label>Rail Gauge</label>
          <select
            value={gaugeTypeId}
            onChange={(e) => onGaugeTypeChange(e.target.value)}
          >
            {GAUGE_TYPES.map(gt => (
              <option key={gt.id} value={gt.id}>
                {gt.name} ({gt.gauge.toFixed(3)} m)
              </option>
            ))}
          </select>
        </div>
        {designGauge && (
          <div style={{ fontSize: 9, color: 'var(--text-dim)', paddingLeft: 60, marginTop: -4, marginBottom: 8 }}>
            Reference: {designGauge.toFixed(3)} m &mdash; gaugeDiff = measured &minus; {designGauge.toFixed(3)} m
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="section-title">
          <span style={{ color: '#3b82f6' }}>&#9670;</span> Left Rail
        </div>
        <div className="input-group">
          <label>Easting</label>
          <input
            type="number"
            step="0.001"
            placeholder="0.000"
            value={newPoint.leftEasting}
            onChange={(e) => handleChange('leftEasting', e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Northing</label>
          <input
            type="number"
            step="0.001"
            placeholder="0.000"
            value={newPoint.leftNorthing}
            onChange={(e) => handleChange('leftNorthing', e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Height</label>
          <input
            type="number"
            step="0.001"
            placeholder="0.000"
            value={newPoint.leftHeight}
            onChange={(e) => handleChange('leftHeight', e.target.value)}
          />
        </div>
      </div>

      <div className="panel-section">
        <div className="section-title">
          <span style={{ color: '#ef4444' }}>&#9670;</span> Right Rail
        </div>
        <div className="input-group">
          <label>Easting</label>
          <input
            type="number"
            step="0.001"
            placeholder="0.000"
            value={newPoint.rightEasting}
            onChange={(e) => handleChange('rightEasting', e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Northing</label>
          <input
            type="number"
            step="0.001"
            placeholder="0.000"
            value={newPoint.rightNorthing}
            onChange={(e) => handleChange('rightNorthing', e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Height</label>
          <input
            type="number"
            step="0.001"
            placeholder="0.000"
            value={newPoint.rightHeight}
            onChange={(e) => handleChange('rightHeight', e.target.value)}
          />
        </div>
      </div>

      <div className="panel-section">
        <div className="section-title">
          <span className="material-icons" style={{ fontSize: 14 }}>settings</span>
          Geometry
        </div>
        <div className="input-group">
          <label>Type</label>
          <select
            value={newPoint.type}
            onChange={(e) => handleChange('type', e.target.value)}
          >
            <option value="straight">Straight</option>
            <option value="arc">Arc</option>
          </select>
        </div>
        <div className="input-group">
          <label>Radius</label>
          <input
            type="number"
            step="0.1"
            placeholder="0 (straight)"
            value={newPoint.radius}
            onChange={(e) => handleChange('radius', e.target.value)}
          />
        </div>
        <button
          className="btn btn-primary"
          onClick={onAddPoint}
          style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
        >
          + Add Point (L+R Rail)
        </button>
      </div>

      <div className="panel-section">
        <div className="section-title">
          <span className="material-icons" style={{ fontSize: 14 }}>storage</span>
          Data Actions
        </div>
        <button
          className="btn"
          onClick={onExportData}
          style={{ width: '100%', justifyContent: 'center', marginBottom: 6 }}
        >
          <span className="material-icons" style={{ fontSize: 15 }}>download</span>
          Export CSV
        </button>
        <button
          className="btn"
          onClick={onClearData}
          style={{ width: '100%', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 15 }}>delete</span>
          Clear All
        </button>
      </div>
    </div>
  );
}
