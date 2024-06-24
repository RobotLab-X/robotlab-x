import { FormControl, InputLabel, MenuItem, Select } from "@mui/material"
import React from "react"

const MicrophoneSelect = ({ mics, selectedMic, handleMicChange }) => {
  return (
    <FormControl fullWidth>
      <InputLabel id="microphone-select-label">Microphones</InputLabel>
      <Select labelId="microphone-select-label" value={selectedMic} label="Microphones" onChange={handleMicChange}>
        {Object.entries(mics).map(([key, value]) => (
          <MenuItem key={key} value={key}>
            {value}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}

export default MicrophoneSelect
