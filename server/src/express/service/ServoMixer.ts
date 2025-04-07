import * as fs from "fs"
import * as path from "path"
import * as yaml from "yaml"
import Main from "../../electron/Main"
import { getLogger } from "../framework/LocalLog"
import Service from "../framework/Service"
import RobotLabXRuntime from "./RobotLabXRuntime"

const log = getLogger("ServoMixer")

interface ServoPosition {
  id: string
  name: string
  pin: string
  degrees: number
  speed: number
}

interface Pose {
  name: string
  positions: ServoPosition[]
}

interface Sequence {
  name: string
  poses: Pose[]
}

export default class ServoMixer extends Service {
  config = {
    sequences: [],
    sequencesDir: "sequences",
    currentSequence: null,
    currentPose: null
  }

  sequences: Sequence[] = []

  constructor(
    public id: string,
    public name: string,
    public typeKey: string,
    public version: string,
    public hostname: string
  ) {
    super(id, name, typeKey, version, hostname)
  }

  startService(): void {
    super.startService()
    this.loadSequences()
  }

  /**
   * Get the directory for storing sequences
   */
  private getSequencesDir(): string {
    // Get the main instance to access paths
    const main = Main.getInstance()
    if (!main || !main.publicRoot) {
      log.error("Cannot access Main.publicRoot - using fallback path")
      return path.join(
        process.cwd(),
        "server",
        "src",
        "express",
        "public",
        "repo",
        "servomixer",
        this.config.sequencesDir
      )
    }
    return path.join(main.publicRoot, "repo", "servomixer", this.config.sequencesDir)
  }

  /**
   * Ensure the sequences directory exists
   */
  private ensureSequencesDir(): void {
    const dir = this.getSequencesDir()
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true })
        log.info(`Created sequences directory: ${dir}`)
      } catch (err) {
        log.error(`Failed to create sequences directory: ${err.message}`)
      }
    }
  }

  /**
   * Load all sequence files from the sequences directory
   */
  loadSequences(): Sequence[] {
    this.ensureSequencesDir()
    const dir = this.getSequencesDir()

    try {
      const files = fs.readdirSync(dir).filter((file) => file.endsWith(".yml"))
      this.sequences = []

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), "utf8")
          const sequence = yaml.parse(content) as Sequence
          this.sequences.push(sequence)
          log.info(`Loaded sequence: ${sequence.name}`)
        } catch (err) {
          log.error(`Failed to load sequence ${file}: ${err.message}`)
        }
      }

      this.broadcastState()
      return this.sequences
    } catch (err) {
      log.error(`Failed to read sequences directory: ${err.message}`)
      return []
    }
  }

  /**
   * Get a list of available sequences
   */
  getSequences(): string[] {
    return this.sequences.map((seq) => seq.name)
  }

  /**
   * Get a specific sequence by name
   */
  getSequence(name: string): Sequence {
    return this.sequences.find((seq) => seq.name === name)
  }

  /**
   * Create a new sequence
   */
  createSequence(name: string): Sequence {
    if (this.sequences.some((seq) => seq.name === name)) {
      log.warn(`Sequence ${name} already exists`)
      return null
    }

    const newSequence: Sequence = {
      name,
      poses: []
    }

    this.sequences.push(newSequence)
    this.config.currentSequence = name
    this.saveSequence(newSequence)
    this.broadcastState()
    return newSequence
  }

  /**
   * Delete a sequence by name
   */
  deleteSequence(name: string): boolean {
    const index = this.sequences.findIndex((seq) => seq.name === name)
    if (index === -1) {
      log.warn(`Sequence ${name} not found`)
      return false
    }

    this.sequences.splice(index, 1)

    // Delete the file
    try {
      const filePath = path.join(this.getSequencesDir(), `${name}.yml`)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        log.info(`Deleted sequence file: ${filePath}`)
      }
    } catch (err) {
      log.error(`Failed to delete sequence file: ${err.message}`)
    }

    if (this.config.currentSequence === name) {
      this.config.currentSequence = null
      this.config.currentPose = null
    }

    this.broadcastState()
    return true
  }

  /**
   * Save a sequence to file
   */
  saveSequence(sequence: Sequence): boolean {
    this.ensureSequencesDir()

    try {
      const filePath = path.join(this.getSequencesDir(), `${sequence.name}.yml`)
      const yamlStr = yaml.stringify(sequence)
      fs.writeFileSync(filePath, yamlStr, "utf8")
      log.info(`Saved sequence to ${filePath}`)
      this.broadcastState()
      return true
    } catch (err) {
      log.error(`Failed to save sequence: ${err.message}`)
      return false
    }
  }

  /**
   * Set the current active sequence
   */
  setCurrentSequence(name: string): boolean {
    const sequence = this.sequences.find((seq) => seq.name === name)
    if (!sequence) {
      log.warn(`Sequence ${name} not found`)
      return false
    }

    this.config.currentSequence = name
    this.config.currentPose = null
    this.broadcastState()
    return true
  }

  /**
   * Get poses for the current sequence
   */
  getPoses(): string[] {
    if (!this.config.currentSequence) {
      return []
    }

    const sequence = this.sequences.find((seq) => seq.name === this.config.currentSequence)
    if (!sequence) {
      return []
    }

    return sequence.poses.map((pose) => pose.name)
  }

  /**
   * Create a new pose in the current sequence
   */
  createPose(name: string): Pose {
    if (!this.config.currentSequence) {
      log.warn("No current sequence selected")
      return null
    }

    const sequence = this.sequences.find((seq) => seq.name === this.config.currentSequence)
    if (!sequence) {
      log.warn(`Current sequence ${this.config.currentSequence} not found`)
      return null
    }

    if (sequence.poses.some((pose) => pose.name === name)) {
      log.warn(`Pose ${name} already exists in sequence ${this.config.currentSequence}`)
      return null
    }

    const newPose: Pose = {
      name,
      positions: []
    }

    sequence.poses.push(newPose)
    this.config.currentPose = name
    this.saveSequence(sequence)
    this.broadcastState()
    return newPose
  }

  /**
   * Delete a pose from the current sequence
   */
  deletePose(name: string): boolean {
    if (!this.config.currentSequence) {
      log.warn("No current sequence selected")
      return false
    }

    const sequence = this.sequences.find((seq) => seq.name === this.config.currentSequence)
    if (!sequence) {
      log.warn(`Current sequence ${this.config.currentSequence} not found`)
      return false
    }

    const index = sequence.poses.findIndex((pose) => pose.name === name)
    if (index === -1) {
      log.warn(`Pose ${name} not found in sequence ${this.config.currentSequence}`)
      return false
    }

    sequence.poses.splice(index, 1)

    if (this.config.currentPose === name) {
      this.config.currentPose = null
    }

    this.saveSequence(sequence)
    this.broadcastState()
    return true
  }

  /**
   * Set the current active pose
   */
  setCurrentPose(name: string): boolean {
    if (!this.config.currentSequence) {
      log.warn("No current sequence selected")
      return false
    }

    const sequence = this.sequences.find((seq) => seq.name === this.config.currentSequence)
    if (!sequence) {
      log.warn(`Current sequence ${this.config.currentSequence} not found`)
      return false
    }

    const pose = sequence.poses.find((p) => p.name === name)
    if (!pose) {
      log.warn(`Pose ${name} not found in sequence ${this.config.currentSequence}`)
      return false
    }

    this.config.currentPose = name
    this.broadcastState()
    return true
  }

  /**
   * Get the current pose
   */
  getCurrentPose(): Pose {
    if (!this.config.currentSequence || !this.config.currentPose) {
      return null
    }

    const sequence = this.sequences.find((seq) => seq.name === this.config.currentSequence)
    if (!sequence) {
      return null
    }

    return sequence.poses.find((pose) => pose.name === this.config.currentPose)
  }

  /**
   * Add a servo position to the current pose
   */
  addServoPosition(servoId: string, servoName: string, pin: string, degrees: number, speed: number): boolean {
    if (!this.config.currentSequence || !this.config.currentPose) {
      log.warn("No current sequence or pose selected")
      return false
    }

    const sequence = this.sequences.find((seq) => seq.name === this.config.currentSequence)
    if (!sequence) {
      log.warn(`Current sequence ${this.config.currentSequence} not found`)
      return false
    }

    const pose = sequence.poses.find((p) => p.name === this.config.currentPose)
    if (!pose) {
      log.warn(`Current pose ${this.config.currentPose} not found`)
      return false
    }

    // Remove any existing position for this servo
    const index = pose.positions.findIndex((pos) => pos.id === servoId)
    if (index !== -1) {
      pose.positions.splice(index, 1)
    }

    // Add the new position
    pose.positions.push({
      id: servoId,
      name: servoName,
      pin,
      degrees,
      speed
    })

    this.saveSequence(sequence)
    this.broadcastState()
    return true
  }

  /**
   * Remove a servo position from the current pose
   */
  removeServoPosition(servoId: string): boolean {
    if (!this.config.currentSequence || !this.config.currentPose) {
      log.warn("No current sequence or pose selected")
      return false
    }

    const sequence = this.sequences.find((seq) => seq.name === this.config.currentSequence)
    if (!sequence) {
      log.warn(`Current sequence ${this.config.currentSequence} not found`)
      return false
    }

    const pose = sequence.poses.find((p) => p.name === this.config.currentPose)
    if (!pose) {
      log.warn(`Current pose ${this.config.currentPose} not found`)
      return false
    }

    const index = pose.positions.findIndex((pos) => pos.id === servoId)
    if (index === -1) {
      log.warn(`Servo position for ${servoId} not found in pose ${this.config.currentPose}`)
      return false
    }

    pose.positions.splice(index, 1)
    this.saveSequence(sequence)
    this.broadcastState()
    return true
  }

  /**
   * Apply a pose - move all servos to their positions in the pose
   */
  applyPose(poseName: string): boolean {
    if (!this.config.currentSequence) {
      log.warn("No current sequence selected")
      return false
    }

    const sequence = this.sequences.find((seq) => seq.name === this.config.currentSequence)
    if (!sequence) {
      log.warn(`Current sequence ${this.config.currentSequence} not found`)
      return false
    }

    const pose = sequence.poses.find((p) => p.name === poseName)
    if (!pose) {
      log.warn(`Pose ${poseName} not found in sequence ${this.config.currentSequence}`)
      return false
    }

    // Apply all servo positions in this pose
    const runtime = RobotLabXRuntime.getInstance()

    for (const position of pose.positions) {
      try {
        // Find the servo by id
        const servoService = runtime.getService(position.name)
        if (!servoService) {
          log.warn(`Servo ${position.name} not found`)
          continue
        }

        // Move the servo to the specified position
        log.info(`Moving servo ${position.name} to ${position.degrees} degrees at speed ${position.speed}`)
        servoService.invoke("moveTo", position.degrees, position.speed)
      } catch (err) {
        log.error(`Failed to apply position for servo ${position.name}: ${err.message}`)
      }
    }

    return true
  }

  /**
   * Play a sequence - move through all poses in order
   */
  async playSequence(sequenceName: string, delayMs: number = 1000): Promise<boolean> {
    const sequence = this.sequences.find((seq) => seq.name === sequenceName)
    if (!sequence) {
      log.warn(`Sequence ${sequenceName} not found`)
      return false
    }

    log.info(`Playing sequence ${sequenceName} with ${sequence.poses.length} poses`)

    for (const pose of sequence.poses) {
      log.info(`Applying pose ${pose.name}`)
      this.applyPose(pose.name)

      // Wait for the specified delay before moving to the next pose
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }

    return true
  }

  /**
   * Capture the current positions of all servos and save as a new pose
   */
  capturePose(poseName: string): boolean {
    if (!this.config.currentSequence) {
      log.warn("No current sequence selected")
      return false
    }

    // Create the pose if it doesn't exist
    this.createPose(poseName)
    this.setCurrentPose(poseName)

    // Get all servo services
    const runtime = RobotLabXRuntime.getInstance()
    const servos = runtime.getServicesOfType("Servo")
    
    // Clear any existing positions in this pose if it's a newly created pose
    const currentPose = this.getCurrentPose()
    if (currentPose && currentPose.positions.length === 0) {
      log.info(`Capturing current positions of all servos (${servos.length} servos found)`)
      
      for (const servo of servos) {
        try {
          // Get the current servo configuration
          const config = servo.config
          
          if (!config) {
            log.warn(`Servo ${servo.name} has no config, skipping`)
            continue
          }
          
          // Determine position value - prefer current degrees, fall back to rest position or default
          const degrees = typeof config.degrees === 'number' ? config.degrees : 
                        (typeof config.rest === 'number' ? config.rest : 90)
          
          // Determine speed value - use configured speed or default
          const speed = typeof config.speed === 'number' ? config.speed : 50
          
          // Add this servo position to the pose
          this.addServoPosition(
            servo.id,
            servo.name,
            config.pin || "",
            degrees,
            speed
          )
          
          log.info(`Captured position for servo ${servo.name}: ${degrees} degrees at speed ${speed}`)
        } catch (err) {
          log.error(`Failed to capture position for servo ${servo.name}: ${err.message}`)
        }
      }
    } else {
      log.info(`Updating existing pose with current servo positions`)
      
      // For existing poses, update the positions of servos that are already in the pose
      if (currentPose) {
        for (const position of currentPose.positions) {
          try {
            const servo = runtime.getService(position.id)
            if (!servo) {
              log.warn(`Servo ${position.name} (${position.id}) not found, keeping existing position`)
              continue
            }
            
            const config = servo.config
            if (!config) {
              log.warn(`Servo ${servo.name} has no config, keeping existing position`)
              continue
            }
            
            // Determine position value - prefer current degrees, fall back to rest position or default
            const degrees = typeof config.degrees === 'number' ? config.degrees : 
                          (typeof config.rest === 'number' ? config.rest : position.degrees)
            
            // Determine speed value - use configured speed or keep existing
            const speed = typeof config.speed === 'number' ? config.speed : position.speed
            
            // Update this servo position in the pose
            this.addServoPosition(
              servo.id,
              servo.name,
              config.pin || position.pin,
              degrees,
              speed
            )
            
            log.info(`Updated position for servo ${servo.name}: ${degrees} degrees at speed ${speed}`)
          } catch (err) {
            log.error(`Failed to update position for servo ${position.name}: ${err.message}`)
          }
        }
        
        // Also add any servos that aren't yet in the pose
        for (const servo of servos) {
          if (!currentPose.positions.some(p => p.id === servo.id)) {
            try {
              const config = servo.config
              
              if (!config) {
                log.warn(`Servo ${servo.name} has no config, skipping`)
                continue
              }
              
              // Determine position value - prefer current degrees, fall back to rest position or default
              const degrees = typeof config.degrees === 'number' ? config.degrees : 
                            (typeof config.rest === 'number' ? config.rest : 90)
              
              // Determine speed value - use configured speed or default
              const speed = typeof config.speed === 'number' ? config.speed : 50
              
              // Add this servo position to the pose
              this.addServoPosition(
                servo.id,
                servo.name,
                config.pin || "",
                degrees,
                speed
              )
              
              log.info(`Added new servo to pose: ${servo.name} at ${degrees} degrees and speed ${speed}`)
            } catch (err) {
              log.error(`Failed to add new servo ${servo.name} to pose: ${err.message}`)
            }
          }
        }
      }
    }
    
    return true
  }

  /**
   * Send broadcastState notifications to subscribers
   */
  broadcastState(): void {
    this.invoke("publishState", {
      sequences: this.getSequences(),
      currentSequence: this.config.currentSequence,
      poses: this.getPoses(),
      currentPose: this.config.currentPose,
      currentPoseData: this.getCurrentPose()
    })
  }

  /**
   * Publish the current state to subscribers
   */
  publishState(state: any): any {
    return state
  }
}
