import React, { useState, useEffect } from "react"
import { Box, Typography, useTheme } from "@mui/material"
import { DataGrid } from "@mui/x-data-grid"
import { tokens } from "../theme"
import { mockDataTeam } from "../data/mockData"
import ServiceTabs from "../components/ServiceTabs"
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined"
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined"
import SecurityOutlinedIcon from "@mui/icons-material/SecurityOutlined"
import Header from "../components/Header"
import { JSONTree } from "react-json-tree"
import { useStore } from "../store/store"

const Network = () => {
  const theme = useTheme()
  const colors = tokens(theme.palette.mode)
  const columns = [
    { field: "id", headerName: "Id" },
    {
      field: "direction",
      headerName: "Direction",
      flex: 1,
      cellClassName: "name-column--cell",
    },
    {
      field: "service",
      headerName: "Service",
      headerAlign: "left",
      align: "left",
    },
    {
      field: "method",
      headerName: "Method",
      flex: 1,
    },
    {
      field: "data",
      headerName: "Data",
      flex: 1,
    },
  ]

  const msg = useStore((state) => state.messages["i01.opencv@vertx-vertx.onWebDisplay"])
  // const [imageData, setImageData] = useState("/i01.opencv-03386.png")
  const [imageData, setImageData] = useState(null)

  // useFrame(() => {
  //   // console.log(img)
  // })

  useEffect(() => {
    console.log("OpenCV2 useLayoutEffect")
    let img = msg?.data[0]?.data
    if (img) {
      setImageData(img)
    }
  }, [msg])

  return (
    <>
      <img src={imageData} alt="blah" />
      <Box m="20px">
        <Header title="Network" subtitle="Current network details" />
        <Box
          m="40px 0 0 0"
          height="75vh"
          sx={{
            "& .MuiDataGrid-root": {
              border: "none",
            },
            "& .MuiDataGrid-cell": {
              borderBottom: "none",
            },
            "& .name-column--cell": {
              color: colors.greenAccent[300],
            },
            "& .MuiDataGrid-columnHeaders": {
              backgroundColor: colors.blueAccent[700],
              borderBottom: "none",
            },
            "& .MuiDataGrid-virtualScroller": {
              backgroundColor: colors.primary[400],
            },
            "& .MuiDataGrid-footerContainer": {
              borderTop: "none",
              backgroundColor: colors.blueAccent[700],
            },
            "& .MuiCheckbox-root": {
              color: `${colors.greenAccent[200]} !important`,
            },
          }}
        >
          <DataGrid checkboxSelection rows={mockDataTeam} columns={columns} />
        </Box>
      </Box>
    </>
  )
}

export default Network
