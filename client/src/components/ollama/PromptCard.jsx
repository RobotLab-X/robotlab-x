import { Box, Card, CardContent, Typography } from "@mui/material"
import React from "react"
import ReactJson from "react-json-view"

const PromptCard = ({ currentPromptKey, currentPrompt, getBaseUrl, name }) => (
  <Card sx={{ minWidth: 275, mx: 2 }}>
    <CardContent>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
        <img src={`${getBaseUrl()}/service/${name}/prompts/${currentPromptKey}.png`} width="64" alt="robot pict" />
        <Typography variant="h2" component="div">
          {currentPromptKey}
        </Typography>
      </Box>
      <Typography variant="h5" component="div">
        {currentPrompt?.description}
      </Typography>
      <Typography variant="h5" component="div">
        Prompts
      </Typography>
      {currentPrompt?.messages &&
        Object.entries(currentPrompt.messages).map(([key, messages]) => (
          <Box key={key}>
            <Typography variant="subtitle1" component="div">
              {key}
            </Typography>
            {Array.isArray(messages) ? (
              messages.map((message, index) => (
                <Typography key={index} variant="subtitle1" component="span" color="textSecondary">
                  {message.content}
                </Typography>
              ))
            ) : (
              <Typography variant="subtitle1" component="span" color="textSecondary">
                {messages.content}
              </Typography>
            )}
          </Box>
        ))}
      <Typography variant="h5" component="div">
        Tools
      </Typography>
      <Typography variant="subtitle1" component="span" color="textSecondary">
        {currentPrompt?.tools && (
          <ReactJson
            src={currentPrompt.tools}
            name="tools"
            displayDataTypes={false}
            displayObjectSize={false}
            style={{ fontSize: "12px" }}
            collapsed={false}
          />
        )}
      </Typography>
    </CardContent>
  </Card>
)

export default PromptCard
