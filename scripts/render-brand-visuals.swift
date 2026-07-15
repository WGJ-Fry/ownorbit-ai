#!/usr/bin/env swift
import AppKit
import AVFoundation
import CoreGraphics
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum RenderError: Error, CustomStringConvertible {
    case usage
    case image(String)
    case destination(String)
    case writer(String)

    var description: String {
        switch self {
        case .usage:
            return "Usage: render-brand-visuals.swift gif|mp4 OUTPUT SECONDS_PER_SLIDE IMAGE... | crop OUTPUT X Y WIDTH HEIGHT IMAGE"
        case .image(let path):
            return "Could not read image: \(path)"
        case .destination(let path):
            return "Could not create output: \(path)"
        case .writer(let message):
            return message
        }
    }
}

func writeImage(_ image: CGImage, output: String) throws {
    let url = URL(fileURLWithPath: output)
    let type = url.pathExtension.lowercased() == "png" ? UTType.png : UTType.jpeg
    guard let destination = CGImageDestinationCreateWithURL(
        url as CFURL,
        type.identifier as CFString,
        1,
        nil
    ) else {
        throw RenderError.destination(output)
    }
    let properties: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.92]
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
        throw RenderError.destination(output)
    }
}

func cropImage(output: String, x: Int, y: Int, width: Int, height: Int, path: String) throws {
    let source = try loadImage(path)
    guard let cropped = source.cropping(to: CGRect(x: x, y: y, width: width, height: height)) else {
        throw RenderError.writer("Crop rectangle is outside the source image")
    }
    try writeImage(cropped, output: output)
}

func loadImage(_ path: String) throws -> CGImage {
    guard let image = NSImage(contentsOfFile: path),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw RenderError.image(path)
    }
    return cgImage
}

func renderGif(output: String, secondsPerSlide: Double, paths: [String]) throws {
    let outputURL = URL(fileURLWithPath: output) as CFURL
    guard let destination = CGImageDestinationCreateWithURL(
        outputURL,
        UTType.gif.identifier as CFString,
        paths.count,
        nil
    ) else {
        throw RenderError.destination(output)
    }

    let global: [CFString: Any] = [
        kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]
    ]
    CGImageDestinationSetProperties(destination, global as CFDictionary)

    for path in paths {
        let properties: [CFString: Any] = [
            kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: secondsPerSlide]
        ]
        CGImageDestinationAddImage(destination, try loadImage(path), properties as CFDictionary)
    }
    guard CGImageDestinationFinalize(destination) else {
        throw RenderError.destination(output)
    }
}

func pixelBuffer(from image: CGImage, width: Int, height: Int) throws -> CVPixelBuffer {
    var maybeBuffer: CVPixelBuffer?
    let attributes: [CFString: Any] = [
        kCVPixelBufferCGImageCompatibilityKey: true,
        kCVPixelBufferCGBitmapContextCompatibilityKey: true,
    ]
    let status = CVPixelBufferCreate(
        kCFAllocatorDefault,
        width,
        height,
        kCVPixelFormatType_32BGRA,
        attributes as CFDictionary,
        &maybeBuffer
    )
    guard status == kCVReturnSuccess, let buffer = maybeBuffer else {
        throw RenderError.writer("Could not allocate a video frame")
    }

    CVPixelBufferLockBaseAddress(buffer, [])
    defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
    guard let context = CGContext(
        data: CVPixelBufferGetBaseAddress(buffer),
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue
    ) else {
        throw RenderError.writer("Could not create the video drawing context")
    }
    context.setFillColor(NSColor.black.cgColor)
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return buffer
}

func renderMp4(output: String, secondsPerSlide: Double, paths: [String]) throws {
    let images = try paths.map(loadImage)
    guard let first = images.first else { throw RenderError.usage }
    let width = first.width
    let height = first.height
    let url = URL(fileURLWithPath: output)
    try? FileManager.default.removeItem(at: url)

    let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
    let settings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: 2_800_000,
            AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        ],
    ]
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
    input.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: input,
        sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
        ]
    )
    guard writer.canAdd(input) else { throw RenderError.writer("Video writer rejected the input") }
    writer.add(input)
    guard writer.startWriting() else {
        throw RenderError.writer(writer.error?.localizedDescription ?? "Video writer failed to start")
    }
    writer.startSession(atSourceTime: .zero)

    let fps: Int32 = 2
    let repeats = max(1, Int((secondsPerSlide * Double(fps)).rounded()))
    var frameIndex: Int64 = 0
    for image in images {
        let buffer = try pixelBuffer(from: image, width: width, height: height)
        for _ in 0..<repeats {
            while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.01) }
            let time = CMTime(value: frameIndex, timescale: fps)
            guard adaptor.append(buffer, withPresentationTime: time) else {
                throw RenderError.writer(writer.error?.localizedDescription ?? "Could not append video frame")
            }
            frameIndex += 1
        }
    }
    input.markAsFinished()
    let semaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { semaphore.signal() }
    semaphore.wait()
    guard writer.status == .completed else {
        throw RenderError.writer(writer.error?.localizedDescription ?? "Video writer did not complete")
    }
}

do {
    let arguments = Array(CommandLine.arguments.dropFirst())
    guard let mode = arguments.first else { throw RenderError.usage }
    if mode == "crop" {
        guard arguments.count == 7,
              let x = Int(arguments[2]),
              let y = Int(arguments[3]),
              let width = Int(arguments[4]),
              let height = Int(arguments[5]) else {
            throw RenderError.usage
        }
        let output = arguments[1]
        try FileManager.default.createDirectory(
            at: URL(fileURLWithPath: output).deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try cropImage(output: output, x: x, y: y, width: width, height: height, path: arguments[6])
        print("Generated \(output)")
        exit(0)
    }
    guard arguments.count >= 4, let seconds = Double(arguments[2]) else { throw RenderError.usage }
    let output = arguments[1]
    let paths = Array(arguments.dropFirst(3))
    try FileManager.default.createDirectory(
        at: URL(fileURLWithPath: output).deletingLastPathComponent(),
        withIntermediateDirectories: true
    )
    if mode == "gif" {
        try renderGif(output: output, secondsPerSlide: seconds, paths: paths)
    } else if mode == "mp4" {
        try renderMp4(output: output, secondsPerSlide: seconds, paths: paths)
    } else {
        throw RenderError.usage
    }
    print("Generated \(output)")
} catch {
    fputs("\(error)\n", stderr)
    exit(1)
}
