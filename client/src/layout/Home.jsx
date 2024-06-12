import { Box, Card, CardActionArea, CardContent, Typography } from "@mui/material"
import SendMsgTextArea from "components/SendMsgTextArea"
import ServicePage from "components/ServicePage"
import React, { useState } from "react"
import { useStore } from "store/store"

function Home() {
  const [selectedCard, setSelectedCard] = useState(null)
  const [filter, setFilter] = useState("")
  const getRepoUrl = useStore((state) => state.getRepoUrl)
  const repo = useStore((state) => state.repo)
  // registry is "initial" information about the service, not the current state
  const registry = useStore((state) => state.registry)
  const serviceArray = Object.values(registry)
  const filteredCards = serviceArray.filter((card) => card.name.toLowerCase().includes(filter.toLowerCase()))
  const remoteId = useStore((state) => state.defaultRemoteId)
  const debug = useStore((state) => state.debug)
  const getTypeImage = useStore((state) => state.getTypeImage)

  const handleCardClick = (card) => {
    setSelectedCard(card)
  }

  return (
    <>
      <Box sx={{ display: "flex", height: "100vh" }}>
        <Box sx={{ width: "300px", overflowY: "auto" }}>
          {/*}
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
              </AppBar>*/}
          {filteredCards.map((card, index) => (
            <Card key={index} onClick={() => handleCardClick(card)} sx={{ margin: 1 }}>
              <CardActionArea>
                <CardContent>
                  <Typography variant="h5">
                    <img
                      src={getTypeImage(card.fullname)}
                      alt={card.name}
                      width="32"
                      style={{ verticalAlign: "top" }}
                    />
                    {/*
                    <img
                      src={`${imagesUrl}/platform/${repo[card.typeKey]?.platform}.png`}
                      alt={card.typeKey}
                      width="16"
                    />{" "}
                    <img src={`${imagesUrl}/os/linux.png`} alt={card.typeKey} width="16" />
                    */}
                    &nbsp;{card.name}
                  </Typography>
                  {remoteId !== card.id ? (
                    <Typography variant="body2" color="text.secondary">
                      {repo[card.typeKey]?.title} {card.id}
                    </Typography>
                  ) : (
                    <></>
                  )}
                </CardContent>
              </CardActionArea>
            </Card>
          ))}

          {debug && <SendMsgTextArea msg={JSON.stringify({ name: "j1", method: "broadcastState" }, null, 2)} />}
        </Box>
        <Box sx={{ flexGrow: 1, p: 3 }}>
          {selectedCard ? (
            <div>
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

      <br />
    </>
  )
}

export default Home
