import loadable from "@loadable/component"
import { useStore } from "../store/store"

// TODO - React.lazy vs react-loadable
export default function ServicePage(props) {
  const registry = useStore((state) => state.registry)
  let service = registry[props.fullname]
  let type = service.typeKey

  // FIXME - this is a pain, it should dynamically check if the service exists
  // but no library or native lazy loader seems to support this
  const types = [
    "Clock",
    "Docker",
    "MyRobotLabConnector",
    "OakD",
    "Ollama",
    "RobotLabXRuntime",
    "Runtime",
    "TestNodeService",
    "TestPythonService",
    "WebXR"
  ]

  if (!types.includes(type)) {
    type = "Unknown"
  }

  let AsyncPage = null

  try {
    // FIXME - test with throwable fetch and to determine if loadable is possible
    AsyncPage = loadable(() => import(`../service/${type}`))
  } catch (error) {
    return <div>Service not found</div>
  }

  return (
    <div className="service-content-div">
      <AsyncPage page={type} name={props.name} id={props.id} fullname={props.fullname} />
    </div>
  )
}
