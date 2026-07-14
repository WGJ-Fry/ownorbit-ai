import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
    @EnvironmentObject private var entryStore: LifeOSEntryStore

    var body: some View {
        Group {
            if let entry = entryStore.entry {
                BrowserScreen(entry: entry)
            } else {
                ConnectScreen()
            }
        }
        .background(Color(red: 0.024, green: 0.039, blue: 0.063).ignoresSafeArea())
    }
}

private struct ConnectScreen: View {
    @EnvironmentObject private var entryStore: LifeOSEntryStore
    @EnvironmentObject private var cloudStore: LifeOSCloudDataStore
    @State private var showImporter = false
    @State private var showCloudData = false
    @State private var showManual = false
    @State private var manualURL = ""

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Spacer(minLength: 36)
                Image(systemName: "sparkles.rectangle.stack.fill")
                    .font(.system(size: 30, weight: .semibold))
                    .foregroundStyle(.cyan)
                    .frame(width: 64, height: 64)
                    .background(Color.cyan.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))

                VStack(alignment: .leading, spacing: 10) {
                    Text("connect.title")
                        .font(.system(size: 34, weight: .bold))
                    Text("connect.body")
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task {
                        await cloudStore.enableAndSync()
                        showImporter = true
                    }
                } label: {
                    Label("connect.icloudButton", systemImage: "icloud.and.arrow.down")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
                .disabled(entryStore.isChecking || cloudStore.isSyncing)

                Button {
                    showCloudData = true
                } label: {
                    Label("connect.cloudDataButton", systemImage: "checkmark.icloud")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(cloudStore.isSyncing || cloudStore.isWriting)

                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "lock.shield")
                        .foregroundStyle(.mint)
                    Text("connect.security")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                DisclosureGroup("connect.manualDisclosure", isExpanded: $showManual) {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("connect.manualPlaceholder", text: $manualURL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .textFieldStyle(.roundedBorder)
                        Button {
                            Task { await entryStore.connect(manualURL: manualURL) }
                        } label: {
                            Label("connect.manualButton", systemImage: "link")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.bordered)
                        .disabled(entryStore.isChecking || manualURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                    .padding(.top, 14)
                }
                .font(.subheadline.weight(.semibold))

                if entryStore.isChecking {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("connect.checking")
                    }
                    .foregroundStyle(.secondary)
                }

                if cloudStore.isSyncing {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("cloud.status.syncing")
                    }
                    .foregroundStyle(.secondary)
                }

                StatusBand(message: entryStore.statusMessage, tone: entryStore.statusTone)
                Spacer(minLength: 32)
            }
            .padding(.horizontal, 24)
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json], allowsMultipleSelection: false) { result in
            switch result {
            case .success(let urls):
                guard let url = urls.first else { return }
                Task { await entryStore.importEntry(from: url) }
            case .failure:
                break
            }
        }
        .sheet(isPresented: $showCloudData) {
            CloudDataScreen()
        }
    }
}

private struct BrowserScreen: View {
    @EnvironmentObject private var entryStore: LifeOSEntryStore
    let entry: SavedLifeOSEntry
    @State private var reloadToken = UUID()
    @State private var loading = true
    @State private var failureMessage = ""
    @State private var confirmForget = false
    @State private var showCloudData = ProcessInfo.processInfo.arguments.contains("--show-cloud-data")

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.desktopName)
                        .font(.headline)
                        .lineLimit(1)
                    Text(entry.sameWifiOnly ? "browser.sameWifi" : "browser.remoteReady")
                        .font(.caption)
                        .foregroundStyle(entry.sameWifiOnly ? Color.orange : Color.mint)
                }
                Spacer()
                if loading { ProgressView().controlSize(.small) }
                Button {
                    showCloudData = true
                } label: {
                    Image(systemName: "icloud")
                }
                .accessibilityLabel(Text("cloud.title"))
                Button {
                    reloadToken = UUID()
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel(Text("browser.reload"))
                Button {
                    confirmForget = true
                } label: {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                }
                .accessibilityLabel(Text("browser.changeEntry"))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.ultraThinMaterial)

            if entry.isStale {
                Label("browser.stale", systemImage: "exclamationmark.triangle")
                    .font(.footnote)
                    .foregroundStyle(.orange)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.orange.opacity(0.1))
            }

            if !failureMessage.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 34))
                        .foregroundStyle(.orange)
                    Text(failureMessage)
                        .multilineTextAlignment(.center)
                    Button("browser.retry") { reloadToken = UUID() }
                        .buttonStyle(.borderedProminent)
                        .tint(.cyan)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(24)
            } else {
                LifeOSWebView(entry: entry, reloadToken: reloadToken, loading: $loading, failureMessage: $failureMessage)
                    .ignoresSafeArea(edges: .bottom)
            }
        }
        .confirmationDialog("browser.changeConfirmTitle", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("browser.changeConfirm", role: .destructive) { entryStore.forgetEntry() }
            Button("common.cancel", role: .cancel) {}
        } message: {
            Text("browser.changeConfirmBody")
        }
        .sheet(isPresented: $showCloudData) {
            CloudDataScreen()
        }
    }
}

private struct StatusBand: View {
    let message: String
    let tone: LifeOSEntryStore.StatusTone

    var body: some View {
        if !message.isEmpty {
            Label(message, systemImage: icon)
                .font(.footnote)
                .foregroundStyle(color)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private var color: Color {
        switch tone {
        case .neutral: return .secondary
        case .success: return .mint
        case .warning: return .orange
        case .error: return .red
        }
    }

    private var icon: String {
        switch tone {
        case .neutral: return "info.circle"
        case .success: return "checkmark.circle"
        case .warning: return "exclamationmark.triangle"
        case .error: return "xmark.octagon"
        }
    }
}
