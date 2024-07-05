import React from "react"

const GridToggle = ({ showGrid, setShowGrid }) => (
  <label>
    <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
    Grid
  </label>
)

export default GridToggle
