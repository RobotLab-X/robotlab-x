import React, { useEffect, useState } from "react"
import ForceGraph2D from "react-force-graph-2d"
import { useNavigate, useParams } from "react-router-dom"
import { useStore } from "store/store"

const Nodes = () => {
  const [nodes, setNodes] = useState([])
  const [links, setLinks] = useState([])
  const navigate = useNavigate()
  const { nodeId } = useParams()
  const getRepoUrl = useStore((state) => state.getRepoUrl)

  const registry = useStore((state) => state.registry)
  const serviceArray = Object.values(registry)

  useEffect(() => {
    if (registry) {
      let filteredNodes
      let filteredLinks

      if (nodeId) {
        filteredNodes = serviceArray
          .filter((service) => service.id === nodeId)
          .map((service) => ({
            id: service.id,
            name: service.name,
            group: 1,
            typeKey: service.typeKey
          }))
        filteredLinks = []
      } else {
        filteredNodes = serviceArray
          .filter((service) => service.name === "runtime")
          .map((service) => ({
            id: service.id,
            name: service.name,
            group: 1,
            typeKey: service.typeKey
          }))
        filteredLinks = filteredNodes.slice(1).map((service, index) => ({
          source: filteredNodes[index].id,
          target: service.id
        }))
      }

      setNodes(filteredNodes)
      setLinks(filteredLinks)
    }
  }, [registry, nodeId])

  const handleNodeClick = (node) => {
    navigate(`/nodes/${node.id}`)
  }

  return (
    <div style={{ height: "400px" }}>
      <ForceGraph2D
        graphData={{ nodes, links }}
        nodeAutoColorBy="group"
        linkWidth={2}
        nodeLabel="id"
        onNodeClick={handleNodeClick}
        nodeCanvasObject={(node, ctx, globalScale) => {
          const img = new Image()
          img.src = `${getRepoUrl()}/${node.typeKey}/${node.typeKey}.png`
          const idLabel = node.id
          const nameLabel = node.name
          const fontSize = 12 / globalScale
          const size = 20

          img.onload = () => {
            ctx.save()
            ctx.clearRect(node.x - size / 2, node.y - size / 2, size, size) // Clear the area first
            ctx.drawImage(img, node.x - size / 2, node.y - size / 2, size, size)
            ctx.restore()

            // Draw the ID text
            ctx.font = `${fontSize}px Sans-Serif`
            ctx.fillStyle = "black"
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(idLabel, node.x, node.y - 8)

            // Draw the Name text
            ctx.fillText(nameLabel, node.x, node.y + 8)
          }

          if (img.complete) {
            ctx.save()
            ctx.clearRect(node.x - size / 2, node.y - size / 2, size, size) // Clear the area first
            ctx.drawImage(img, node.x - size / 2, node.y - size / 2, size, size)
            ctx.restore()

            // Draw the ID text
            ctx.font = `${fontSize}px Sans-Serif`
            ctx.fillStyle = "black"
            ctx.textAlign = "center"
            ctx.textBaseline = "middle"
            ctx.fillText(idLabel, node.x, node.y - 8)

            // Draw the Name text
            ctx.fillText(nameLabel, node.x, node.y + 8)
          }
        }}
      />
    </div>
  )
}

export default Nodes
