import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import SaveIcon from "@mui/icons-material/Save";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  MenuItem,
  Select,
  Slider,
  TextField,
  Typography,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import React, { useEffect, useState } from "react";
import { useStore } from "../store/store";
import useServiceSubscription from "../store/useServiceSubscription";
import { useProcessedMessage } from "../hooks/useProcessedMessage";

export default function ServoMixer({ name, fullname, id }) {
  const { useMessage, sendTo } = useStore();
  const serviceMsg = useServiceSubscription(fullname, ["publishState"]);
  const service = useProcessedMessage(serviceMsg);
  
  // State variables
  const [sequences, setSequences] = useState([]);
  const [currentSequence, setCurrentSequence] = useState(null);
  const [poses, setPoses] = useState([]);
  const [currentPose, setCurrentPose] = useState(null);
  const [currentPoseData, setCurrentPoseData] = useState(null);
  const [servos, setServos] = useState([]);
  
  // Dialog states
  const [createSequenceDialogOpen, setCreateSequenceDialogOpen] = useState(false);
  const [createPoseDialogOpen, setCreatePoseDialogOpen] = useState(false);
  const [playSequenceDialogOpen, setPlaySequenceDialogOpen] = useState(false);
  const [sequenceDelay, setSequenceDelay] = useState(1000);
  const [newSequenceName, setNewSequenceName] = useState("");
  const [newPoseName, setNewPoseName] = useState("");

  // Load initial data
  useEffect(() => {
    sendTo(fullname, "loadSequences");
  }, [fullname, sendTo]);

  // Update state when service state changes
  useEffect(() => {
    if (service?.publishState) {
      const state = service.publishState;
      if (state.sequences) setSequences(state.sequences);
      if (state.currentSequence !== undefined) setCurrentSequence(state.currentSequence);
      if (state.poses) setPoses(state.poses);
      if (state.currentPose !== undefined) setCurrentPose(state.currentPose);
      if (state.currentPoseData) setCurrentPoseData(state.currentPoseData);
    }
  }, [service]);

  // Load available servos from runtime
  useEffect(() => {
    // Get a reference to the runtime
    const runtimeName = "runtime";
    
    // Function to process services response
    const processServices = (servicesData) => {
      if (servicesData && Array.isArray(servicesData)) {
        const filteredServos = servicesData.filter(service => 
          service.typeKey === "Servo" && service.id !== fullname
        );
        setServos(filteredServos);
      }
    };
    
    // Request services list initially
    sendTo(runtimeName, "getServices", (response) => {
      processServices(response);
    });
    
    // Subscribe to service registry changes to detect new servos
    const subscribeToRegistry = () => {
      sendTo(runtimeName, "subscribe", "registry");
    };
    
    // Poll for services periodically to catch newly added ones
    const intervalId = setInterval(() => {
      sendTo(runtimeName, "getServices", (response) => {
        processServices(response);
      });
    }, 5000); // Check every 5 seconds
    
    subscribeToRegistry();
    
    return () => {
      sendTo(runtimeName, "unsubscribe", "registry");
      clearInterval(intervalId);
    };
  }, [fullname, sendTo]);

  // Dialog handlers
  const handleCreateSequenceOpen = () => setCreateSequenceDialogOpen(true);
  const handleCreateSequenceClose = () => setCreateSequenceDialogOpen(false);
  const handleCreatePoseOpen = () => setCreatePoseDialogOpen(true);
  const handleCreatePoseClose = () => setCreatePoseDialogOpen(false);
  const handlePlaySequenceOpen = () => setPlaySequenceDialogOpen(true);
  const handlePlaySequenceClose = () => setPlaySequenceDialogOpen(false);

  // Action handlers
  const handleCreateSequence = () => {
    if (newSequenceName) {
      sendTo(fullname, "createSequence", newSequenceName);
      setNewSequenceName("");
      handleCreateSequenceClose();
    }
  };

  const handleDeleteSequence = (name) => {
    if (window.confirm(`Are you sure you want to delete sequence '${name}'?`)) {
      sendTo(fullname, "deleteSequence", name);
    }
  };

  const handleSelectSequence = (name) => {
    sendTo(fullname, "setCurrentSequence", name);
  };

  const handleCreatePose = () => {
    if (newPoseName) {
      sendTo(fullname, "createPose", newPoseName);
      setNewPoseName("");
      handleCreatePoseClose();
    }
  };

  const handleDeletePose = (name) => {
    if (window.confirm(`Are you sure you want to delete pose '${name}'?`)) {
      sendTo(fullname, "deletePose", name);
    }
  };

  const handleSelectPose = (name) => {
    sendTo(fullname, "setCurrentPose", name);
  };

  const handleCapturePose = () => {
    if (currentSequence && currentPose) {
      sendTo(fullname, "capturePose", currentPose);
    } else if (currentSequence && newPoseName) {
      sendTo(fullname, "capturePose", newPoseName);
      setNewPoseName("");
      handleCreatePoseClose();
    }
  };

  const handleApplyPose = (poseName) => {
    sendTo(fullname, "applyPose", poseName);
  };

  const handlePlaySequence = () => {
    if (currentSequence) {
      sendTo(fullname, "playSequence", currentSequence, sequenceDelay);
      handlePlaySequenceClose();
    }
  };

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>
        Servo Mixer
      </Typography>

      {/* Sequences Section */}
      <Card sx={{ mb: 4 }}>
        <CardContent>
          <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
            <Typography variant="h5">Sequences</Typography>
            <Button 
              variant="contained" 
              color="primary" 
              onClick={handleCreateSequenceOpen}
            >
              New Sequence
            </Button>
          </Box>

          <List>
            {sequences.map((seq) => (
              <ListItem 
                key={seq} 
                button 
                selected={currentSequence === seq}
                onClick={() => handleSelectSequence(seq)}
                sx={{
                  bgcolor: currentSequence === seq ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
                  borderRadius: 1
                }}
              >
                <ListItemText primary={seq} />
                <ListItemSecondaryAction>
                  <IconButton 
                    edge="end" 
                    onClick={() => handleDeleteSequence(seq)}
                    color="error"
                  >
                    <DeleteIcon />
                  </IconButton>
                  <IconButton 
                    edge="end" 
                    onClick={handlePlaySequenceOpen}
                    color="success"
                    disabled={currentSequence !== seq}
                  >
                    <PlayArrowIcon />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        </CardContent>
      </Card>

      {/* Poses Section */}
      {currentSequence && (
        <Card sx={{ mb: 4 }}>
          <CardContent>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h5">
                Poses for Sequence: {currentSequence}
              </Typography>
              <Box>
                <Button 
                  variant="contained" 
                  color="primary" 
                  onClick={handleCreatePoseOpen}
                  sx={{ mr: 1 }}
                >
                  New Pose
                </Button>
                <Button 
                  variant="contained" 
                  color="secondary" 
                  onClick={handleCapturePose}
                  startIcon={<SaveIcon />}
                >
                  Capture Current
                </Button>
              </Box>
            </Box>

            <List>
              {poses.map((pose) => (
                <ListItem 
                  key={pose} 
                  button 
                  selected={currentPose === pose}
                  onClick={() => handleSelectPose(pose)}
                  sx={{
                    bgcolor: currentPose === pose ? 'rgba(0, 0, 0, 0.08)' : 'transparent',
                    borderRadius: 1
                  }}
                >
                  <ListItemText primary={pose} />
                  <ListItemSecondaryAction>
                    <IconButton 
                      edge="end" 
                      onClick={() => handleDeletePose(pose)}
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                    <IconButton 
                      edge="end" 
                      onClick={() => handleApplyPose(pose)}
                      color="success"
                    >
                      <PlayArrowIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          </CardContent>
        </Card>
      )}

      {/* Current Pose Details */}
      {currentPoseData && (
        <Card>
          <CardContent>
            <Typography variant="h5" gutterBottom>
              Pose Details: {currentPoseData.name}
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              {currentPoseData.positions.length} servo positions saved
            </Typography>

            {currentPoseData.positions.map((position, index) => (
              <Accordion key={position.id}>
                <AccordionSummary
                  expandIcon={<ExpandMoreIcon />}
                >
                  <Typography>
                    {position.name} - {position.degrees}° at speed {position.speed}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid item xs={12}>
                      <Typography variant="body2" color="textSecondary">
                        ID: {position.id}
                      </Typography>
                      <Typography variant="body2" color="textSecondary">
                        Pin: {position.pin}
                      </Typography>
                    </Grid>
                    <Grid item xs={12}>
                      <Typography gutterBottom>Position</Typography>
                      <Slider
                        value={position.degrees}
                        min={0}
                        max={180}
                        valueLabelDisplay="auto"
                        onChange={(event, value) => {
                          // Update position in pose
                          sendTo(fullname, "addServoPosition", 
                            position.id,
                            position.name,
                            position.pin,
                            value,
                            position.speed
                          );
                        }}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Typography gutterBottom>Speed</Typography>
                      <Slider
                        value={position.speed}
                        min={1}
                        max={100}
                        valueLabelDisplay="auto"
                        onChange={(event, value) => {
                          // Update speed in pose
                          sendTo(fullname, "addServoPosition", 
                            position.id,
                            position.name,
                            position.pin,
                            position.degrees,
                            value
                          );
                        }}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <Button 
                        color="error" 
                        onClick={() => sendTo(fullname, "removeServoPosition", position.id)}
                        startIcon={<DeleteIcon />}
                      >
                        Remove Position
                      </Button>
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>
            ))}

            {/* Available Servos Section */}
              <Box mt={3}>
                <Typography variant="h6" gutterBottom>
                  Available Servos
                </Typography>
                {servos.length > 0 ? (
                  <Grid container spacing={2}>
                    {servos.map((servo) => {
                      // Check if this servo is already in the pose
                      const isInPose = currentPoseData.positions.some(p => p.id === servo.id);
                      return (
                        <Grid item xs={12} md={6} key={servo.id}>
                          <Card 
                            variant="outlined" 
                            sx={{ 
                              mb: 2,
                              borderColor: isInPose ? 'primary.main' : 'grey.300',
                              borderWidth: isInPose ? 2 : 1,
                              position: 'relative',
                              opacity: isInPose ? 0.7 : 1
                            }}
                          >
                            <CardContent>
                              <Typography variant="h6">{servo.name}</Typography>
                              <Typography variant="body2" color="textSecondary">
                                ID: {servo.id}
                              </Typography>
                              {servo.config && (
                                <>
                                  <Typography variant="body2" color="textSecondary">
                                    Pin: {servo.config.pin || "Not set"}
                                  </Typography>
                                  <Typography variant="body2" color="textSecondary">
                                    Current Position: {servo.config.degrees || servo.config.rest || 90}°
                                  </Typography>
                                </>
                              )}
                              
                              <Box mt={2}>
                                {!isInPose ? (
                                  <Button 
                                    variant="contained" 
                                    color="primary" 
                                    fullWidth
                                    onClick={() => {
                                      if (servo && servo.config) {
                                        sendTo(fullname, "addServoPosition", 
                                          servo.id,
                                          servo.name,
                                          servo.config.pin || "",
                                          servo.config.degrees || servo.config.rest || 90,
                                          servo.config.speed || 50
                                        );
                                      }
                                    }}
                                  >
                                    Add to Pose
                                  </Button>
                                ) : (
                                  <Button 
                                    variant="outlined" 
                                    color="error" 
                                    fullWidth
                                    onClick={() => sendTo(fullname, "removeServoPosition", servo.id)}
                                  >
                                    Remove from Pose
                                  </Button>
                                )}
                              </Box>
                              
                              {/* Mini servo controls */}
                              <Box mt={2}>
                                <Typography gutterBottom>Position</Typography>
                                <Slider
                                  defaultValue={servo.config?.degrees || servo.config?.rest || 90}
                                  min={0}
                                  max={180}
                                  valueLabelDisplay="auto"
                                  onChangeCommitted={(event, value) => {
                                    // Update actual servo position
                                    sendTo(servo.id, "moveTo", value);
                                    
                                    // If in pose, update the pose position too
                                    if (isInPose) {
                                      const position = currentPoseData.positions.find(p => p.id === servo.id);
                                      if (position) {
                                        sendTo(fullname, "addServoPosition", 
                                          position.id,
                                          position.name,
                                          position.pin,
                                          value,
                                          position.speed
                                        );
                                      }
                                    }
                                  }}
                                />
                              </Box>
                              
                              <Box mt={2}>
                                <Typography gutterBottom>Speed</Typography>
                                <Slider
                                  defaultValue={servo.config?.speed || 50}
                                  min={1}
                                  max={100}
                                  valueLabelDisplay="auto"
                                  onChangeCommitted={(event, value) => {
                                    // Update actual servo speed
                                    sendTo(servo.id, "setSpeed", value);
                                    
                                    // If in pose, update the pose speed too
                                    if (isInPose) {
                                      const position = currentPoseData.positions.find(p => p.id === servo.id);
                                      if (position) {
                                        sendTo(fullname, "addServoPosition", 
                                          position.id,
                                          position.name,
                                          position.pin,
                                          position.degrees,
                                          value
                                        );
                                      }
                                    }
                                  }}
                                />
                              </Box>
                              
                              {isInPose && (
                                <Box mt={2} display="flex" justifyContent="space-between">
                                  <Button 
                                    variant="outlined" 
                                    color="primary"
                                    onClick={() => {
                                      // Update the pose with the current servo position and speed
                                      const currentDegrees = servo.config?.degrees || servo.config?.rest || 90;
                                      const currentSpeed = servo.config?.speed || 50;
                                      sendTo(fullname, "addServoPosition", 
                                        servo.id,
                                        servo.name,
                                        servo.config?.pin || "",
                                        currentDegrees,
                                        currentSpeed
                                      );
                                    }}
                                  >
                                    Update in Pose
                                  </Button>
                                  
                                  <Button 
                                    variant="contained" 
                                    color="primary"
                                    onClick={() => {
                                      // Find the position in the pose
                                      const position = currentPoseData.positions.find(p => p.id === servo.id);
                                      if (position) {
                                        // Move the servo to the position defined in the pose
                                        sendTo(servo.id, "moveTo", position.degrees, position.speed);
                                      }
                                    }}
                                  >
                                    Apply from Pose
                                  </Button>
                                </Box>
                              )}
                            </CardContent>
                          </Card>
                        </Grid>
                      );
                    })}
                  </Grid>
                ) : (
                  <Typography variant="body1" color="textSecondary" align="center">
                    No servos available. Create a servo service first.
                  </Typography>
                )}
              </Box>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      {/* Create Sequence Dialog */}
      <Dialog open={createSequenceDialogOpen} onClose={handleCreateSequenceClose}>
        <DialogTitle>Create New Sequence</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Enter a name for the new sequence.
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="Sequence Name"
            fullWidth
            value={newSequenceName}
            onChange={(e) => setNewSequenceName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreateSequenceClose} color="primary">
            Cancel
          </Button>
          <Button onClick={handleCreateSequence} color="primary" variant="contained">
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Create Pose Dialog */}
      <Dialog open={createPoseDialogOpen} onClose={handleCreatePoseClose}>
        <DialogTitle>Create New Pose</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Enter a name for the new pose.
          </DialogContentText>
          <TextField
            autoFocus
            margin="dense"
            label="Pose Name"
            fullWidth
            value={newPoseName}
            onChange={(e) => setNewPoseName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCreatePoseClose} color="primary">
            Cancel
          </Button>
          <Button onClick={handleCreatePose} color="primary" variant="contained">
            Create Empty
          </Button>
          <Button onClick={() => {
            handleCapturePose();
            handleCreatePoseClose();
          }} color="secondary" variant="contained">
            Capture Current
          </Button>
        </DialogActions>
      </Dialog>

      {/* Play Sequence Dialog */}
      <Dialog open={playSequenceDialogOpen} onClose={handlePlaySequenceClose}>
        <DialogTitle>Play Sequence</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Set the delay between poses in milliseconds.
          </DialogContentText>
          <Box sx={{ mt: 2 }}>
            <Typography gutterBottom>Delay between poses (ms)</Typography>
            <Slider
              value={sequenceDelay}
              min={100}
              max={5000}
              step={100}
              marks
              valueLabelDisplay="auto"
              onChange={(e, value) => setSequenceDelay(value)}
            />
            <Typography variant="body2" color="textSecondary" align="center">
              {sequenceDelay} ms
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handlePlaySequenceClose} color="primary">
            Cancel
          </Button>
          <Button onClick={handlePlaySequence} color="primary" variant="contained">
            Play
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}