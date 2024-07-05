import ServicePane from "components/ServicePane"
import React, { useEffect, useRef, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import { useNavigate, useParams } from "react-router-dom"
import SplitPane from "react-split-pane"
import { useProcessedMessage } from "../hooks/useProcessedMessage"
import { useStore } from "../store/store"
import useServiceSubscription from "../store/useServiceSubscription"

const Nodes = () => {
  const [nodes, setNodes] = useState([]) // State to store nodes
  const [links, setLinks] = useState([]) // State to store links between nodes
  const [mode, setMode] = useState("services") // State to determine display mode (services, ids, hosts)
  const [selectedService, setSelectedService] = useState(null) // State for selected service
  const navigate = useNavigate()
  const { nodeId } = useParams()
  const getRepoUrl = useStore((state) => state.getRepoUrl)
  const getTypeImage = useStore((state) => state.getTypeImage)

  const registry = useStore((state) => state.services)
  const serviceArray = Object.values(registry)
  const fgRef = useRef()

  const defaultRemoteId = useStore((state) => state.defaultRemoteId)
  const serviceMsg = useServiceSubscription(`runtime@${defaultRemoteId}`, [])

  const service = useProcessedMessage(serviceMsg)

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

  // Function to handle node click event and navigate to node details
  const handleNodeClick = (node) => {
    setSelectedService(serviceArray.find((service) => service.fullname === node.id))
    navigate(`/nodes/${node.id}`)
  }

  // Function to stop the simulation
  const stopSimulation = () => {
    if (fgRef.current) {
      fgRef.current.d3Force("link", null)
      fgRef.current.d3Force("charge", null)
      fgRef.current.d3Force("center", null)
    }
  }

  return (
    <>
      <style>{`
        html, body, #root, .SplitPane {
          height: 100%;
          margin: 0;
          padding: 0;
        }
        .pane {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          justify-content: flex-start;
          height: 100%;
        }
      `}</style>
      <SplitPane split="vertical" minSize={200} defaultSize="70%">
        <div className="pane">
          {/* Force-directed graph to display nodes and links */}
          <div>
            <ForceGraph2D
              ref={fgRef}
              graphData={{ nodes, links }}
              nodeAutoColorBy="group"
              linkWidth={2}
              nodeLabel="name"
              onNodeClick={handleNodeClick}
              onNodeDragEnd={() => {
                stopSimulation()
              }}
              linkDirectionalArrowLength={6}
              linkDirectionalArrowRelPos={1}
              linkCurvature={0.25}
              linkCanvasObjectMode={() => "after"}
              linkCanvasObject={(link, ctx, globalScale) => {
                const MAX_FONT_SIZE = 4
                const LABEL_NODE_MARGIN = 1.5
                const start = link.source
                const end = link.target

                // Calculate the midpoint of the link
                const midPos = Object.assign(
                  ...["x", "y"].map((c) => ({
                    [c]: start[c] + (end[c] - start[c]) / 2 // Calculate middle point
                  }))
                )

                const relLink = { x: end.x - start.x, y: end.y - start.y }

                const textPos = Object.assign(
                  ...["x", "y"].map((c) => ({
                    [c]: midPos[c] - relLink[c] / 2
                  }))
                )

                const linkLabel = `${link.source.name} -> ${link.target.name}`

                // Estimate font size to fit in link length
                ctx.font = "1px Sans-Serif"
                const fontSize = Math.min(MAX_FONT_SIZE, 8 / ctx.measureText(linkLabel).width)
                ctx.font = `${fontSize}px Sans-Serif`
                ctx.fillStyle = "rgba(0, 0, 0, 0.8)"
                ctx.textAlign = "center"
                ctx.textBaseline = "middle"

                // Draw text label along the edge
                ctx.save()
                ctx.translate(textPos.x, textPos.y)
                ctx.rotate(Math.atan2(relLink.y, relLink.x))
                ctx.fillText(linkLabel, 0, 0)
                ctx.restore()
              }}
              linkDirectionalParticles={1}
              linkDirectionalParticleSpeed={0.01}
              linkDirectionalParticleWidth={2}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const img = new Image()
                img.src = getTypeImage(node.id)
                const nameLabel = node.name
                const fontSize = 12 / globalScale
                const size = 12

                // Draw the node image and label
                img.onload = () => {
                  ctx.save()
                  ctx.clearRect(node.x - size / 2, node.y - size / 2, size, size)
                  // Draw rounded edge outline
                  ctx.beginPath()
                  ctx.drawImage(img, node.x - size / 2, node.y - size / 2, size, size)

                  ctx.font = `${fontSize}px Sans-Serif`
                  ctx.fillStyle = "black"
                  ctx.textAlign = "center"
                  ctx.textBaseline = "middle"
                  ctx.fillText(nameLabel, node.x, node.y + 18)
                }

                if (img.complete) {
                  ctx.save()
                  ctx.clearRect(node.x - size / 2, node.y - size / 2, size, size)
                  // Draw rounded edge outline
                  ctx.beginPath()
                  ctx.drawImage(img, node.x - size / 2, node.y - size / 2, size, size)

                  ctx.font = `${fontSize}px Sans-Serif`
                  ctx.fillStyle = "black"
                  ctx.textAlign = "center"
                  ctx.textBaseline = "middle"
                  ctx.fillText(nameLabel, node.x, node.y + 18)
                }
              }}
            />
          </div>
        </div>
        <div className="pane">
          <ServicePane service={selectedService} mode={mode} setMode={setMode} />
        </div>
      </SplitPane>
    </>
  )
}

export default Nodes
