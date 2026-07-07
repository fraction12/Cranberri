import AppKit

let emoji = "🫐"
let output = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "buildResources/icon-1024.png"
let pixels = 1024
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: pixels,
  pixelsHigh: pixels,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: pixels, height: pixels).fill()

let paragraph = NSMutableParagraphStyle()
paragraph.alignment = .center
let font = NSFont(name: "Apple Color Emoji", size: 560) ?? NSFont.systemFont(ofSize: 560)
let attributes: [NSAttributedString.Key: Any] = [
  .font: font,
  .paragraphStyle: paragraph,
]
let attributed = NSAttributedString(string: emoji, attributes: attributes)
let textSize = attributed.size()
let rect = NSRect(
  x: (CGFloat(pixels) - textSize.width) / 2,
  y: (CGFloat(pixels) - textSize.height) / 2 + 38,
  width: textSize.width,
  height: textSize.height
)
attributed.draw(in: rect)
NSGraphicsContext.restoreGraphicsState()

guard let png = rep.representation(using: .png, properties: [:]) else {
  fatalError("Could not render emoji icon")
}

let url = URL(fileURLWithPath: output)
try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
try png.write(to: url)
print(output)
