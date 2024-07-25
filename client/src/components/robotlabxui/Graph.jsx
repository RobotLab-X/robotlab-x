import React, { useEffect, useRef } from "react"
import ForceGraph2D from "react-force-graph-2d"
import { useStore } from "store/store"

const Graph = ({ nodes, links, onNodeClick, onNodeRightClick, imageCache, setImageCache }) => {
  const fgRef = useRef()
  const getTypeImage = useStore((state) => state.getTypeImage)

  useEffect(() => {
    const fg = fgRef.current
    if (fg) {
      fg.d3Force("link", null)
      fg.d3Force("charge", null)
      fg.d3Force("center", null)
      fg.d3Force("collide", null)
    }
  }, [])

  const handleNodeDrag = (node) => {
    node.fx = node.x
    node.fy = node.y
  }

  const handleNodeDragEnd = (node) => {
    node.fx = null
    node.fy = null
  }

  const handleNodeClick = (node, event) => {
    // const rect = canvas.getBoundingClientRect()
    // const clickX = clientX - rect.left
    // let nodex = 0.35 * clickX - 130

    onNodeClick(node, event)
  }

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={{ nodes, links }}
      nodeAutoColorBy="group"
      linkWidth={2}
      nodeLabel="name"
      onNodeClick={(node, event) => handleNodeClick(node, event)}
      onNodeRightClick={(node, event) => onNodeRightClick(node, event)} //{onNodeRightClick}
      onNodeDrag={handleNodeDrag}
      onNodeDragEnd={handleNodeDragEnd}
      linkDirectionalArrowLength={6}
      linkDirectionalArrowRelPos={1}
      linkCurvature={0.25}
      linkCanvasObjectMode={() => "after"}
      linkDirectionalParticles={1}
      linkDirectionalParticleSpeed={0.01}
      linkDirectionalParticleWidth={2}
      nodeRelSize={8}
      nodeCanvasObject={(node, ctx, globalScale) => {
        const drawImage = (img, node) => {
          const size = 12
          ctx.save()
          ctx.clearRect(node.x - size / 2, node.y - size / 2, size, size)
          ctx.drawImage(img, node.x - size / 2, node.y - size / 2, size, size)
          ctx.font = `${12 / globalScale}px Sans-Serif`
          ctx.fillStyle = "black"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.fillText(node.name, node.x, node.y + 9)
          // // Draw small circle
          // ctx.beginPath()
          // ctx.arc(node.x + size / 2 + 2, node.y, 1, 0, 2 * Math.PI, false)
          // ctx.fillStyle = "grey"
          // ctx.fill()
          // ctx.strokeStyle = "grey"
          // ctx.lineWidth = 1
          // ctx.stroke()
          // ctx.restore()

          // ctx.save()
          // ctx.beginPath()
          // ctx.arc(node.x - size / 2 - 2, node.y, 1, 0, 2 * Math.PI, false)
          // ctx.fillStyle = "grey"
          // ctx.fill()
          // ctx.strokeStyle = "grey"
          // ctx.lineWidth = 1
          // ctx.stroke()
          // ctx.restore()
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
