export {}

declare global {
  interface Window {
    cranberri: {
      getVersion: () => Promise<string>
    }
  }
}
