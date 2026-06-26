# RobotLab-X PRD

## Overview

RobotLab-X is a modern robotics orchestration platform designed to make robotics accessible to beginners while remaining powerful enough for professional robotics engineers.

The platform combines:

- Visual workflow orchestration
- Real-time robotics messaging
- AI-assisted automation
- Dynamic package/service installation
- Graphical debugging and telemetry visualization
- Scriptable robotics control
- Microservice orchestration
- Extensible plugin/service architecture

## Core Technical Requirements

### Backend

Mandatory requirements:

- FastAPI backend
- Backend generated from:
  - `cloudseeder/templates/app/robotlab_x.yml`
  - `create_app.py`
- Async-first architecture
- WebSocket-first communication model
- Event-driven design
- Service-oriented runtime

### Frontend

Mandatory requirements:

- Vite
- React
- TypeScript
- Modern component architecture
- Responsive layouts
- Dockable/draggable UI system
- Professional desktop-like UX

### Communication

Primary communication protocol:

- WebSockets using JSON messages

Secondary integrations:

- ROS2
- MQTT
- HTTP APIs
- Local IPC

## Product Vision

RobotLab-X enables users to build intelligent robotic systems through composable services, workflows, scripts, and graphical tooling.

The system should allow users to:

- Connect sensors, actuators, AI models, cameras, and cloud services
- Dynamically install robotics capabilities on demand
- Visually orchestrate robotic workflows
- Observe robot state and message traffic in real time
- Build robot applications without deep robotics expertise
- Operate local robots, distributed robots, and cloud robotics systems

## Core Product Principles

### Beginner Friendly

The system must provide:

- Minimal installation complexity
- Strong visual tooling
- Discoverable workflows
- Safe defaults
- Guided onboarding
- Simple service configuration

### Professional Grade

The system must support:

- ROS2 integrations
- MQTT integrations
- Distributed robotics systems
- AI model orchestration
- Multi-process deployments
- Remote robots
- Edge/cloud hybrid architectures

### Extensible By Design

RobotLab-X must install light and dynamically extend itself.

Capabilities are added dynamically through packages and services.

Supported package types:

- Python packages
- NPM packages
- RobotLab-X packages
- Git repositories
- Dockerized services
- External microservices

## Messaging Architecture

### WebSocket First Design

The system should treat WebSockets as the primary application bus.

All major runtime events should stream in real time:

- Service state updates
- Topic traffic
- Logs
- Telemetry
- Workflow events
- Runtime metrics
- AI events
- Installation progress
- Process lifecycle changes

### Messaging Features

- Publish/subscribe model
- Topic routing
- Service discovery
- Structured JSON messages
- Message tracing
- Message replay support
- Topic inspection
- Event history

## Service Architecture

A service is a modular robotics capability.

Examples:

- Camera
- LIDAR
- Speech recognition
- Motor control
- SLAM
- AI vision
- Servo control
- Navigation
- MQTT bridge
- ROS2 bridge
- OpenAI integration
- Ollama integration

Each service should:

- Expose metadata
- Define inputs/outputs
- Declare dependencies
- Publish events
- Support runtime configuration
- Support lifecycle management

## Dynamic Package Installation

RobotLab-X must dynamically install dependencies based on user workflows.

Supported installation sources:

### Python

- pip packages
- wheels
- git repositories

### Node.js

- npm packages
- local packages
- GitHub repositories

### RobotLab-X Packages

Custom package format supporting:

- metadata
- service definitions
- UI widgets
- dependencies
- startup scripts
- workflow templates

## Local Repository

RobotLab-X maintains a local runtime repository.

This repo acts as:

- installation cache
- package registry
- service workspace
- runtime environment
- configuration source
- process launcher

Services are launched from this local repository.

## User Interface Requirements

### UX Philosophy

The UI is a critical product differentiator.

RobotLab-X must feel:

- modern
- responsive
- graphical
- observable
- discoverable
- professional

### Primary UI Areas

#### 1. Service Graph / Composer

A graphical orchestration canvas inspired by:

- n8n
- Node-RED
- Unreal Blueprints
- Blender node graphs

Capabilities:

- Drag/drop services
- Create connections visually
- Group services
- Visualize message routes
- Inspect message payloads
- Start/stop services
- Edit configurations

#### 2. Real-Time Dashboard

Widget-based dashboard system.

Widgets may include:

- Camera feeds
- Logs
- Topic streams
- Metrics
- Telemetry charts
- Robot maps
- Process status
- Terminal widgets

#### 3. Service Inspector

Clicking a service should expose:

- Metadata
- Inputs/outputs
- Dependencies
- Logs
- Metrics
- Configuration
- Runtime state

#### 4. Message Inspector

Users must be able to inspect:

- Topics
- Payloads
- Routing
- Publishers
- Subscribers
- Message history
- Throughput
- Errors

#### 5. Script Editor

Integrated development environment with:

- Monaco editor
- Python support
- TypeScript support
- Syntax highlighting
- Terminal integration

## AI Integration

RobotLab-X should support:

- Local LLMs
- Cloud LLMs
- Vision models
- Speech models
- Agent frameworks
- Autonomous workflows

Potential integrations:

- OpenAI
- Ollama
- OpenClaw
- LangGraph
- Whisper
- TTS engines

## Process Management

RobotLab-X acts as a microservice orchestrator.

The runtime must support:

- Starting services
- Stopping services
- Restarting services
- Monitoring processes
- Streaming logs
- Dependency resolution
- Crash recovery

## Observability

RobotLab-X must expose strong observability tooling:

- Live logs
- Metrics
- Topic traffic
- Process health
- Dependency graphs
- Event timelines
- Message tracing
- Runtime visualization

## MVP Scope

### Backend

- FastAPI backend generated from CloudSeeder DSL
- WebSocket messaging runtime
- Service lifecycle management
- Package installer
- Local repo manager
- Project persistence

### Frontend

- Vite React TypeScript app
- Graphical service composer
- Dashboard system
- Message inspector
- Service inspector
- Script editor

### Integrations

- ROS2 bridge
- MQTT bridge
- Python service runtime
- NPM service runtime

### Initial Services

- Camera
- Terminal
- MQTT
- ROS2 bridge
- OpenAI/Ollama
- Speech recognition
- TTS
- Logging

## Success Criteria

RobotLab-X succeeds when:

- A beginner can build a robotics workflow visually
- Developers can extend the system dynamically
- Real-time message flow is intuitive and visible
- AI services integrate naturally into robotics workflows
- New robotics capabilities can be installed without rebuilding the platform
- The UI feels modern, professional, and alive
- The system scales from hobby robots to professional robotics systems

## Product Summary

RobotLab-X is a modern robotics orchestration platform built around:

- visual workflows
- real-time messaging
- AI-driven robotics
- extensible services
- dynamic package installation
- observability
- modern developer experience

The long-term vision is to make building intelligent robots as approachable as building software.

The project will be 2 folders in the cloudseeder repo
apps/robotlab_x the backend fastapi server
apps/robotlab_x_ui the vite react front end

code generation from entities managed in templates/apps/robotlab_x.yml will be an important in building the app