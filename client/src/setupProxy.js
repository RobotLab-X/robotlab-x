const { createProxyMiddleware } = require("http-proxy-middleware")

module.exports = function (app) {
  app.use(
    "/api/service",
    createProxyMiddleware({
      target: "http://localhost:8888",
      // target: "https://192.168.0.7:8443",
      changeOrigin: true,
      // ws: true,
      secure: false,
    })
  )
  // app.use(
  //   "/offer",
  //   createProxyMiddleware({
  //     target: "http://192.168.0.7:8080", // webcam.py
  //     changeOrigin: true,
  //     // ws: true,
  //     secure: false,
  //   })
  // )
}
