import SwiftUI

struct CloudDataScreen: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var cloudStore: LifeOSCloudDataStore
    @State private var confirmClear = false

    var body: some View {
        NavigationStack {
            Group {
                if cloudStore.enabled {
                    syncedContent
                } else {
                    enableContent
                }
            }
            .navigationTitle(Text("cloud.title"))
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("common.done") { dismiss() }
                }
                if cloudStore.enabled {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            Task { await cloudStore.sync() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .disabled(cloudStore.isSyncing)
                        .accessibilityLabel(Text("cloud.refresh"))
                    }
                }
            }
            .confirmationDialog("cloud.clear.title", isPresented: $confirmClear, titleVisibility: .visible) {
                Button("cloud.clear.confirm", role: .destructive) { cloudStore.disableAndClear() }
                Button("common.cancel", role: .cancel) {}
            } message: {
                Text("cloud.clear.body")
            }
        }
    }

    private var enableContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Spacer(minLength: 28)
                Image(systemName: "icloud.fill")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(.cyan)
                    .frame(width: 68, height: 68)
                    .background(Color.cyan.opacity(0.12), in: RoundedRectangle(cornerRadius: 18))
                Text("cloud.enable.title")
                    .font(.system(size: 30, weight: .bold))
                Text("cloud.enable.body")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Label("cloud.enable.safe", systemImage: "lock.shield")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button {
                    Task { await cloudStore.enableAndSync() }
                } label: {
                    Label("cloud.enable.button", systemImage: "icloud.and.arrow.down")
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                }
                .buttonStyle(.borderedProminent)
                .tint(.cyan)
                .disabled(cloudStore.isSyncing)
                cloudStatus
                Spacer(minLength: 28)
            }
            .padding(.horizontal, 24)
        }
    }

    private var syncedContent: some View {
        List {
            Section {
                HStack(spacing: 12) {
                    Image(systemName: cloudStore.isSyncing ? "arrow.triangle.2.circlepath.icloud" : "checkmark.icloud")
                        .foregroundStyle(.cyan)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(cloudSummaryTitle)
                            .font(.headline)
                        if let updatedAt = cloudStore.snapshot.updatedAt {
                            Text(updatedAt, style: .relative)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer()
                    Text("\(cloudStore.snapshot.records.count)")
                        .font(.title3.monospacedDigit().weight(.semibold))
                }
                cloudStatus
            }

            ForEach(groupedRecords, id: \.dataType) { group in
                Section(header: Text(sectionTitle(group.dataType))) {
                    ForEach(group.records.prefix(30)) { record in
                        VStack(alignment: .leading, spacing: 5) {
                            HStack {
                                Text(record.displayTitle)
                                    .font(.body.weight(.semibold))
                                    .lineLimit(2)
                                Spacer()
                                if record.requiresUserReview {
                                    Image(systemName: "person.crop.circle.badge.exclamationmark")
                                        .foregroundStyle(.orange)
                                        .accessibilityLabel(Text("cloud.reviewRequired"))
                                }
                            }
                            if !record.displayBody.isEmpty {
                                Text(record.displayBody)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(3)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            Section {
                Button("cloud.clear.button", role: .destructive) { confirmClear = true }
            } footer: {
                Text("cloud.readOnly")
            }
        }
        .overlay {
            if cloudStore.snapshot.records.isEmpty &&
                !cloudStore.isSyncing &&
                (cloudStore.statusTone == .neutral || cloudStore.statusTone == .success) {
                VStack(spacing: 12) {
                    Image(systemName: "icloud.slash")
                        .font(.system(size: 34))
                        .foregroundStyle(.secondary)
                    Text("cloud.empty.title")
                        .font(.headline)
                    Text("cloud.empty.body")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
                .padding(32)
            }
        }
    }

    @ViewBuilder
    private var cloudStatus: some View {
        if !cloudStore.statusMessage.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Label(cloudStore.statusMessage, systemImage: statusIcon)
                    .font(.footnote)
                    .foregroundStyle(statusColor)
                if cloudStore.nextAction != .none {
                    Button {
                        Task { await cloudStore.performNextAction() }
                    } label: {
                        Text(LocalizedStringKey(cloudStore.nextAction.localizationKey))
                    }
                    .buttonStyle(.bordered)
                    .disabled(cloudStore.isSyncing)
                }
            }
        }
    }

    private var cloudSummaryTitle: LocalizedStringKey {
        if cloudStore.isSyncing { return "cloud.status.syncing" }
        switch cloudStore.statusTone {
        case .error, .warning: return "cloud.status.needsAttention"
        case .neutral, .success: return "cloud.status.ready"
        }
    }

    private var groupedRecords: [(dataType: String, records: [LifeOSCloudRecord])] {
        let groups = Dictionary(grouping: cloudStore.snapshot.records, by: \.dataType)
        let order = ["chat-history", "memory", "tasks", "generated-app-state", "device-trust"]
        return order.compactMap { type in
            guard let records = groups[type], !records.isEmpty else { return nil }
            return (type, records)
        }
    }

    private func sectionTitle(_ dataType: String) -> LocalizedStringKey {
        switch dataType {
        case "chat-history": return "cloud.section.chat"
        case "memory": return "cloud.section.memory"
        case "tasks": return "cloud.section.tasks"
        case "generated-app-state": return "cloud.section.apps"
        default: return "cloud.section.devices"
        }
    }

    private var statusColor: Color {
        switch cloudStore.statusTone {
        case .neutral: return .secondary
        case .success: return .mint
        case .warning: return .orange
        case .error: return .red
        }
    }

    private var statusIcon: String {
        switch cloudStore.statusTone {
        case .neutral: return "icloud"
        case .success: return "checkmark.circle"
        case .warning: return "exclamationmark.triangle"
        case .error: return "xmark.octagon"
        }
    }
}
