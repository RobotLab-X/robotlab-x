import CloseIcon from "@mui/icons-material/Close"
import {
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Slider,
  TextField,
  Typography
} from "@mui/material"
import React, { useEffect, useState } from "react"
import { useStore } from "store/store"

export default function Filters({ service, selectedFilter, setSelectedFilter, sendTo, fullname }) {
  const selectedFilterDetails = selectedFilter !== null ? service?.filters[selectedFilter] : null
  const [filter, setFilter] = useState(selectedFilterDetails)
  const getRepoUrl = useStore((state) => state.getRepoUrl)

  useEffect(() => {
    setFilter(selectedFilterDetails)
  }, [selectedFilterDetails])

  const handleSelectFilter = (index) => setSelectedFilter(index)
  const handleRemoveFilter = (index) => {
    sendTo(fullname, "remove_filter", service?.filters[index].name)
    sendTo(fullname, "broadcastState")
    setSelectedFilter(null)
  }

  const handleApply = () => {
    console.log("handleApply")
    sendTo(fullname, "apply_filter_config", filter.name, filter.config)
    sendTo(fullname, "broadcastState")
  }

  return (
    <Box sx={{ width: "45%", p: 2, m: 2 }}>
      <h3>Filter Pipeline</h3>
      {/* {JSON.stringify(filter)}
      <br /> {JSON.stringify(selectedFilterDetails)} */}
      <List>
        {(service?.filters ?? []).map((filter, index) => (
          <ListItem key={index} button selected={index === selectedFilter} onClick={() => handleSelectFilter(index)}>
            <ListItemText primary={`${filter.name} (${filter.typeKey})`} />
            {index === selectedFilter && (
              <IconButton edge="end" onClick={() => handleRemoveFilter(index)}>
                <CloseIcon />
              </IconButton>
            )}
          </ListItem>
        ))}
      </List>
      {selectedFilterDetails && (
        <Box sx={{ mt: 2 }}>
          {selectedFilterDetails.typeKey === "OpenCVFilterFaceDetect" && (
            <Box>
              <Typography variant="body1">Face Detection Type</Typography>
              <Select
                value={filter?.config?.cascade_path || "haarcascade_frontalface_default.xml"}
                onChange={(event) =>
                  setFilter((prev) => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      cascade_path: event.target.value
                    }
                  }))
                }
                displayEmpty
                sx={{ mt: 1, width: "100%" }}
              >
                <MenuItem value="haarcascade_frontalface_default.xml">haarcascade_frontalface_default.xml</MenuItem>
                <MenuItem value="haarcascade_frontalface_alt.xml">haarcascade_frontalface_alt.xml</MenuItem>
                <MenuItem value="haarcascade_frontalface_alt2.xml">haarcascade_frontalface_alt2.xml</MenuItem>
                <MenuItem value="haarcascade_frontalface_alt_tree.xml">haarcascade_frontalface_alt_tree.xml</MenuItem>
                <MenuItem value="haarcascade_profileface.xml">haarcascade_profileface.xml</MenuItem>
                <MenuItem value="haarcascade_eye.xml">haarcascade_eye.xml</MenuItem>
                <MenuItem value="haarcascade_eye_tree_eyeglasses.xml">haarcascade_eye_tree_eyeglasses.xml</MenuItem>
                <MenuItem value="haarcascade_smile.xml">haarcascade_smile.xml</MenuItem>
                <MenuItem value="haarcascade_upperbody.xml">haarcascade_upperbody.xml</MenuItem>
                <MenuItem value="haarcascade_fullbody.xml">haarcascade_fullbody.xml</MenuItem>
                <MenuItem value="haarcascade_lowerbody.xml">haarcascade_lowerbody.xml</MenuItem>
                <MenuItem value="haarcascade_russian_plate_number.xml">haarcascade_russian_plate_number.xml</MenuItem>
                <MenuItem value="haarcascade_hand.xml">haarcascade_hand.xml</MenuItem>
                <MenuItem value="haarcascade_leye.xml">haarcascade_leye.xml</MenuItem>
              </Select>
            </Box>
          )}

          {selectedFilterDetails.typeKey === "OpenCVFilterCanny" && (
            <Box sx={{ width: 300, padding: 2 }}>
              <Typography variant="body1">Lower Threshold</Typography>
              <Slider
                value={filter?.config?.lower_threshold ?? 0}
                onChange={(event, newValue) =>
                  setFilter((prev) => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      lower_threshold: newValue
                    }
                  }))
                }
                min={0}
                max={255}
                valueLabelDisplay="auto"
              />
              <Typography variant="body1">Upper Threshold</Typography>
              <Slider
                value={filter?.config?.upper_threshold ?? 255}
                onChange={(event, newValue) =>
                  setFilter((prev) => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      upper_threshold: newValue
                    }
                  }))
                }
                min={0}
                max={255}
                valueLabelDisplay="auto"
                track="inverted"
              />
              <Typography variant="body1">Kernel</Typography>
              <Select
                value={filter?.config?.kernel ?? 3}
                onChange={(event) =>
                  setFilter((prev) => ({
                    ...prev,
                    config: {
                      ...prev.config,
                      kernel: event.target.value
                    }
                  }))
                }
                fullWidth
              >
                {[3, 5, 7].map((value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          )}

          {selectedFilterDetails.typeKey === "OpenCVFilterFaceRecognition" && (
            <>
              <Typography variant="body1" sx={{ mr: 2 }}>
                Mode
              </Typography>
              <Box sx={{ display: "flex", alignItems: "center", mt: 2 }}>
                <Button
                  variant="contained"
                  sx={{
                    ml: 1,
                    bgcolor: filter?.config?.mode === "learn" ? "grey.700" : "grey.300",
                    color: filter?.config?.mode === "learn" ? "white" : "black"
                  }}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        mode: "learn"
                      }
                    }))
                  }
                >
                  Learn
                </Button>
                <Button
                  variant="contained"
                  sx={{
                    ml: 1,
                    bgcolor: filter?.config?.mode === "train" ? "grey.700" : "grey.300",
                    color: filter?.config?.mode === "train" ? "white" : "black"
                  }}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        mode: "train"
                      }
                    }))
                  }
                >
                  Train
                </Button>

                <Button
                  variant="contained"
                  sx={{
                    ml: 1,
                    bgcolor: filter?.config?.mode === "recognize" ? "grey.700" : "grey.300",
                    color: filter?.config?.mode === "recognize" ? "white" : "black"
                  }}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        mode: "recognize"
                      }
                    }))
                  }
                >
                  Recognize
                </Button>

                <Button
                  variant="contained"
                  sx={{
                    ml: 1,
                    bgcolor: filter?.config?.mode === "idle" ? "grey.700" : "grey.300",
                    color: filter?.config?.mode === "idle" ? "white" : "black"
                  }}
                  onClick={() =>
                    setFilter((prev) => ({
                      ...prev,
                      config: {
                        ...prev.config,
                        mode: "idle"
                      }
                    }))
                  }
                >
                  Idle
                </Button>
              </Box>

              {filter?.config?.mode === "learn" && (
                <Box sx={{ mt: 2 }}>
                  <TextField
                    label="Name"
                    variant="outlined"
                    fullWidth
                    value={filter?.config?.name}
                    onChange={(event) =>
                      setFilter((prev) => ({
                        ...prev,
                        config: {
                          ...prev.config,
                          name: event.target.value
                        }
                      }))
                    }
                  />
                </Box>
              )}

              <Box sx={{ mt: 2 }}>
                <Typography variant="h6">Models</Typography>
                {Object.entries(filter?.image_counts || {}).map(([name, count]) => (
                  <Card key={name} sx={{ mt: 1, display: "flex", alignItems: "center" }}>
                    <CardContent sx={{ display: "flex", alignItems: "center" }}>
                      <img
                        src={`${getRepoUrl()}/opencv/face_recognition_data/${name}/0.jpg`}
                        alt={name}
                        style={{ width: 50, height: 50, marginRight: 16 }}
                      />
                      <div>
                        <Typography variant="body1">Name: {name}</Typography>
                        <Typography variant="body1">Images: {count}</Typography>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </>
          )}

          <Box sx={{ mt: 2 }}>
            <Button variant="contained" color="primary" onClick={handleApply}>
              Apply
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  )
}
