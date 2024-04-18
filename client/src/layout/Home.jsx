import SearchIcon from "@mui/icons-material/Search"
import {
  AppBar,
  Box,
  Card,
  CardActionArea,
  CardContent,
  InputAdornment,
  TextField,
  Toolbar,
  Typography
} from "@mui/material"
import SendMsgTextArea from "components/SendMsgTextArea"
import ServicePage from "components/ServicePage"
import React, { useState } from "react"
import { useStore } from "store/store"

const repoUrl = "http://localhost:3001/repo"

function Home() {
  const [selectedCard, setSelectedCard] = useState(null)
  const [filter, setFilter] = useState("")

  const id = useStore((state) => state.id)
  const repo = useStore((state) => state.repo)
  const registry = useStore((state) => state.registry)
  const serviceArray = Object.values(registry)
  const filteredCards = serviceArray.filter((card) => card.name.toLowerCase().includes(filter.toLowerCase()))

  const handleCardClick = (card) => {
    setSelectedCard(card)
  }

  return (
    <>
      <Box sx={{ display: "flex", height: "100vh" }}>
        <Box sx={{ width: "300px", overflowY: "auto" }}>
          <AppBar position="static" color="default">
            <Toolbar>
              <TextField
                fullWidth
                variant="outlined"
                placeholder="Search..."
                onChange={(e) => setFilter(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  )
                }}
              />
            </Toolbar>
          </AppBar>
          {filteredCards.map((card, index) => (
            <Card key={index} onClick={() => handleCardClick(card)} sx={{ margin: 1 }}>
              <CardActionArea>
                {/*
              <CardMedia
                component="img"
                height="32" 
                image={`${repoUrl}/${card.typeKey}/${card.typeKey}.png`}
                alt={card.name}
        /> */}
                <CardContent>
                  <Typography variant="h5">
                    <img src={`${repoUrl}/${card.typeKey}/${card.typeKey}.png`} alt={card.name} width="32" />
                    &nbsp;{card.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {card.typeKey} {card.id}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
          <SendMsgTextArea msg={JSON.stringify({ name: "runtime", method: "getRegistry" }, null, 2)} />
        </Box>
        <Box sx={{ flexGrow: 1, p: 3 }}>
          {selectedCard ? (
            <div>
              <Typography variant="h4">{selectedCard.name}</Typography>
              <ServicePage
                fullname={`${selectedCard.name}@${selectedCard.id}`}
                name={selectedCard.name}
                id={selectedCard.id}
              />
              <Typography>{selectedCard.detailContent}</Typography>
            </div>
          ) : (
            <Typography variant="h6">Select a card from the left panel.</Typography>
          )}
        </Box>
      </Box>
    </>
  )
}

export default Home
