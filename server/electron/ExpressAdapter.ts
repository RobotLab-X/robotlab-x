class ExpressAdapter {
  constructor(public express: any) {
    this.express = express
  }

  public use(middleware: any) {
    this.express.use(middleware)
  }

  public listen(port: number) {
    this.express.listen(port)
  }
}
