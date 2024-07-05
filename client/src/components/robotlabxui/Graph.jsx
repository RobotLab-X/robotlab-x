import React, { useRef } from "react"
import ForceGraph2D from "react-force-graph-2d"
import { useStore } from "store/store"

const Graph = ({ nodes, links, onNodeClick, imageCache, setImageCache }) => {
  const fgRef = useRef()
  const getTypeImage = useStore((state) => state.getTypeImage)

  // Function to stop the simulation
  const stopSimulation = () => {
    if (fgRef.current) {
      fgRef.current.d3Force("link", null)
      fgRef.current.d3Force("charge", null)
      fgRef.current.d3Force("center", null)
    }
  }

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={{ nodes, links }}
      nodeAutoColorBy="group"
      linkWidth={2}
      nodeLabel="name"
      onNodeClick={onNodeClick}
      onNodeDragEnd={stopSimulation}
      linkDirectionalArrowLength={6}
      linkDirectionalArrowRelPos={1}
      linkCurvature={0.25}
      linkCanvasObjectMode={() => "after"}
      linkCanvasObject={(link, ctx, globalScale) => {
        const MAX_FONT_SIZE = 4
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
        const drawImage = (img, node) => {
          const size = 12
          ctx.save()
          ctx.clearRect(node.x - size / 2, node.y - size / 2, size, size)
          // Draw rounded edge outline
          ctx.beginPath()
          ctx.drawImage(img, node.x - size / 2, node.y - size / 2, size, size)
          ctx.font = `${12 / globalScale}px Sans-Serif`
          ctx.fillStyle = "black"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(node.name, node.x, node.y + 18)
          ctx.restore()
        }

        if (!imageCache[node.id]) {
          const img = new Image()
          img.src = getTypeImage(node.id)
          img.onload = () => {
            setImageCache((prevCache) => ({
              ...prevCache,
              [node.id]: img
            }))
            drawImage(img, node)
          }
        } else {
          drawImage(imageCache[node.id], node)
        }
      }}
    />
  )
}

export default Graph
