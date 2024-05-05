import loadable from "@loadable/component"
import { useStore } from "../store/store"

// TODO - React.lazy vs react-loadable
export default function ServicePage(props) {
  const registry = useStore((state) => state.registry)
  let service = registry[props.fullname]

  let type = service.typeKey
  if (service.typeKey === "WebXR") {
    type = "WebXR"
  } else if (service.typeKey === "MyRobotLabConnector") {
    type = "MyRobotLabConnector"
  } else if (service.typeKey === "Runtime") {
    type = "Runtime"
  } else if (service.typeKey === "RobotLabXRuntime") {
    type = "RobotLabXRuntime"
  } else if (service.typeKey === "Clock") {
    type = "Clock"
  } else if (service.typeKey === "TestNodeService") {
    type = "TestNodeService"
  } else {
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
