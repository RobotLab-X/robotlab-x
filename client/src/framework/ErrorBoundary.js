import { Component } from "react"

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true }
  }

  componentDidCatch(error, info) {
    // You can also log the error to an error reporting service
    console.error("ErrorBoundary caught an error", error, info)
  }

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return null // Or return an empty fragment or a custom error message
    }

    return this.props.children
  }
}

export default ErrorBoundary
