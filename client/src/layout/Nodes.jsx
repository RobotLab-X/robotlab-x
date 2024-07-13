import ArrowForwardIcon from "@mui/icons-material/ArrowForward"
import { Box, Button, Grid, Typography } from "@mui/material"
import Graph from "components/robotlabxui/Graph"
import ServicePage from "components/ServicePage"
import ServicePane from "components/ServicePane"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import useServiceMethods from "hooks/useServiceMethods"
import React, { useEffect, useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import SplitPane from "react-split-pane"
import { useStore } from "store/store"
import useServiceSubscription from "store/useServiceSubscription"

const Nodes = () => {
  const [nodes, setNodes] = useState([]) // State to store nodes
  const [links, setLinks] = useState([]) // State to store links between nodes
  const [mode, setMode] = useState("services") // State to determine display mode (services, ids, hosts)
  const [selectedService, setSelectedService] = useState(null) // State for selected service
  const [showGrid, setShowGrid] = useState(true) // State for grid visibility
  const [imageCache, setImageCache] = useState({}) // State to cache images
  const [rightClickPosition, setRightClickPosition] = useState(null) // State for right-click position
  const [isContextMenuVisible, setIsContextMenuVisible] = useState(false) // State for context menu visibility
  const [currentNodeId, setCurrentNodeId] = useState(null) // State for the current node ID
  const [method1, setMethod1] = useState(null)
  const [service1, setService1] = useState(null)
  const [method2, setMethod2] = useState(null)
  const [service2, setService2] = useState(null)
  const navigate = useNavigate()
  const { nodeId } = useParams()
  const registry = useStore((state) => state.services)
  const { useMessage, sendTo } = useStore()
  const serviceArray = Object.values(registry)
  const defaultRemoteId = useStore((state) => state.defaultRemoteId)
  const serviceMsg = useServiceSubscription(`runtime@${defaultRemoteId}`, [])
  const service = useProcessedMessage(serviceMsg)
  const publishMethods = useServiceMethods(currentNodeId)

  // Function to handle node click event and navigate to node details
  const handleNodeClick = (node, event) => {
    console.info(`Node clicked: ${node.name} ${event}`)
    setSelectedService(serviceArray.find((service) => service.fullname === node.id))
    navigate(`/nodes/${node.id}`)
  }

  const handleNodeRightClick = (node, event) => {
    event.preventDefault()
    console.info(`Node right clicked for node: ${node.name} ${node.fullname} ${node.id}`)

    if (!method1) {
      setService1(node.id)
    } else {
      setService2(node.id)
    }

    sendTo(node.id, "getMethods")
    setRightClickPosition({ x: event.clientX, y: event.clientY - 84 })
    setCurrentNodeId(node.id)
    setIsContextMenuVisible(true)
  }

  const handleClickOutside = (event) => {
    if (isContextMenuVisible && event.target.closest(".context-menu") === null) {
      setIsContextMenuVisible(false)
    }
  }

  const handleKeyDown = (event) => {
    if (isContextMenuVisible && event.key === "Escape") {
      setIsContextMenuVisible(false)
    }
  }

  useEffect(() => {
    document.addEventListener("click", handleClickOutside)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("click", handleClickOutside)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [isContextMenuVisible])

  const handleServiceMethodClick = (item) => {
    console.log(`Menu item clicked: ${item}`)
    if (!method1) {
      setMethod1(item)
    } else {
      setMethod2(item)
    }
    setIsContextMenuVisible(false)
  }

  // Function to initialize node positions in a circular layout
  const initializeNodePositions = (nodes) => {
    const radius = 100
    const angleIncrement = (2 * Math.PI) / nodes?.length || 1

    return nodes?.map((node, index) => {
      const angle = index * angleIncrement
      node.x = radius * Math.cos(angle)
      node.y = radius * Math.sin(angle)
      return node
    })
  }

  // Function to process notify lists and create links between services
  const processNotifyListLinks = (services) => {
    const links = []
    services.forEach((service) => {
      const notifyList = service.notifyList || {}
      Object.keys(notifyList).forEach((topic) => {
        notifyList[topic].forEach((listener) => {
          const targetService = services.find((s) => s.fullname === listener.callbackName)
          if (targetService) {
            links.push({
              source: service.fullname,
              target: targetService.fullname
            })
          }
        })
      })
    })
    return links
  }

  // useEffect to update nodes and links based on registry and service data
  useEffect(() => {
    if (registry && service) {
      let filteredNodes
      let filteredLinks = []

      // Filter nodes based on selected mode
      if (mode === "services") {
        filteredNodes = serviceArray.map((service) => ({
          id: service.fullname,
          name: service.name,
          group: 1,
          typeKey: service.typeKey
        }))
      } else if (mode === "ids" && nodeId) {
        filteredNodes = serviceArray
          ?.filter((service) => service.id === nodeId)
          ?.map((service) => ({
            id: service.fullname,
            name: service.name,
            group: 1,
            typeKey: service.typeKey
          }))
      } else if (mode === "hosts") {
        filteredNodes = serviceArray
          ?.filter((service) => service.name === "runtime")
          ?.map((service) => ({
            id: service.fullname,
            name: service.name,
            group: 1,
            typeKey: service.typeKey
          }))
        service?.routeTable &&
          Object.keys(service.routeTable).forEach((key) => {
            const route = service.routeTable[key]

            filteredLinks.push({
              source: defaultRemoteId,
              target: route.gatewayId
            })
          })
      }

      // Process notify list links and add to filtered links
      const notifyListLinks = processNotifyListLinks(serviceArray)
      filteredLinks = [...filteredLinks, ...notifyListLinks]

      // Set nodes and links in state
      setNodes(initializeNodePositions(filteredNodes))
      setLinks(filteredLinks)
    }
  }, [registry, nodeId, service, mode])

  return (
    <>
      <SplitPane split="vertical" minSize={200} defaultSize="70%">
        <div className={`pane ${showGrid ? "grid" : ""}`}>
          <Graph
            nodes={nodes}
            links={links}
            onNodeClick={handleNodeClick}
            onNodeRightClick={handleNodeRightClick}
            imageCache={imageCache}
            setImageCache={setImageCache}
          />

          {isContextMenuVisible && rightClickPosition && (
            <div className="context-menu active" style={{ top: rightClickPosition.y, left: rightClickPosition.x }}>
              {publishMethods ? (
                publishMethods
                  .filter((method) => {
                    if (method1) {
                      return method.startsWith("on")
                    } else {
                      return method.startsWith("get") || method.startsWith("publish")
                    }
                  })
                  .map((method) => (
                    <div key={method} className="menu-item" onClick={() => handleServiceMethodClick(method)}>
                      {method}
                    </div>
                  ))
              ) : (
                <div className="menu-item">Loading...</div>
              )}
            </div>
          )}
        </div>
        <div style={{ paddingLeft: "20px" }}>
          <ServicePane
            service={selectedService}
            mode={mode}
            setMode={setMode}
            showGrid={showGrid}
            setShowGrid={setShowGrid}
          />
          <Box border={1} borderRadius={4} padding={2}>
            <Typography variant="h6" gutterBottom>
              Routes
            </Typography>
            <Grid
              container
              spacing={2}
              alignItems="center"
              style={{ marginTop: "10px", marginBottom: "10px", marginLeft: "10px", marginRight: "10px" }}
            >
              {method1 && (
                <>
                  <Grid item xs={12}>
                    &nbsp;
                    {service1}.{method1} <ArrowForwardIcon />
                    {service2}.{method2}
                  </Grid>
                  <Grid item xs={12}>
                    <Button variant="contained">Add Route</Button>
                    <Button variant="contained" style={{ marginLeft: "10px" }}>
                      Clear
                    </Button>
                  </Grid>
                </>
              )}
            </Grid>
          </Box>
          <br />
          <br />
          {selectedService ? (
            <ServicePage fullname={selectedService.fullname} name={selectedService.name} id={selectedService.id} />
          ) : (
            <div>No service selected</div>
          )}
        </div>{" "}
      </SplitPane>
    </>
  )
}

export default Nodes
