import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  Tooltip,
  Typography
} from "@mui/material"
import { useProcessedMessage } from "hooks/useProcessedMessage"
import React from "react"
import useStore from "store/store"
import useServiceSubscription from "store/useServiceSubscription"

const PkgDialog = ({ dialogOpen, handleDialogClose, fullname }) => {
  const serviceMsg = useServiceSubscription(fullname)
  const service = useProcessedMessage(serviceMsg)
  const getTypeImage = useStore((state) => state.getTypeImage)
  const getBaseUrl = useStore((state) => state.getBaseUrl)

  const imagesUrl = `${getBaseUrl()}/public/images`

  return (
    <Dialog open={dialogOpen} onClose={handleDialogClose} fullWidth maxWidth="md">
      <DialogTitle>
        <Typography variant="h3">
          <img src={getTypeImage(service?.fullname)} alt={service?.name} width="32" style={{ verticalAlign: "top" }} />{" "}
          {service?.pkg?.title}
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Tooltip title={service?.pkg?.platform}>
          <img src={`${imagesUrl}/platform/${service?.pkg?.platform}.png`} alt={service?.pkg?.platform} width="16" />
        </Tooltip>{" "}
        {service?.pkg?.description}
        <Divider style={{ margin: "20px 0" }} />
        <Typography variant="body1">
          <strong>Version:</strong> {service?.pkg?.version}
        </Typography>
        <Typography variant="body1">
          <strong>Commit:</strong>{" "}
          <Link
            href={`https://github.com/RobotLab-X/robotlab-x/commit/${service?.pkg?.commitHash}`}
            target="_blank"
            rel="noopener"
          >
            {service?.pkg?.shortCommitHash}
          </Link>
        </Typography>
        <Typography variant="body1">
          <strong>Branch:</strong> {service?.pkg?.branch}
        </Typography>
        <Typography variant="body1">
          <strong>Tag:</strong> {service?.pkg?.tag}
        </Typography>
        <Typography variant="body1">
          <strong>Categories:</strong> {service?.pkg?.categories?.join(", ")}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleDialogClose} color="primary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default PkgDialog
