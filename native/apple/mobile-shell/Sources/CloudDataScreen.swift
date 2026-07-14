import SwiftUI

struct CloudDataScreen: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var cloudStore: LifeOSCloudDataStore
    @State private var confirmClear = false
    @State private var confirmClearPending = false
    @State private var pendingTaskCompletion: LifeOSPendingTaskCompletion?
    @State private var showMemoryComposer = ProcessInfo.processInfo.arguments.contains("--cloud-memory-compose-demo")

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
                    ToolbarItemGroup(placement: .topBarTrailing) {
                        Button {
                            showMemoryComposer = true
                        } label: {
                            Image(systemName: "plus")
                        }
                        .disabled(cloudStore.isSyncing || cloudStore.isWriting)
                        .accessibilityLabel(Text("cloud.memory.add"))
                        Button {
                            Task { await cloudStore.sync() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                        .disabled(cloudStore.isSyncing || cloudStore.isWriting)
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
            .confirmationDialog(
                "cloud.outbox.clear.title",
                isPresented: $confirmClearPending,
                titleVisibility: .visible
            ) {
                Button("cloud.outbox.clear.confirm", role: .destructive) { cloudStore.clearPendingMutations() }
                Button("common.cancel", role: .cancel) {}
            } message: {
                Text("cloud.outbox.clear.body")
            }
            .alert(
                "cloud.task.complete.title",
                isPresented: Binding(
                    get: { pendingTaskCompletion != nil },
                    set: { if !$0 { pendingTaskCompletion = nil } }
                ),
                presenting: pendingTaskCompletion
            ) { request in
                Button("cloud.task.complete.confirm") {
                    pendingTaskCompletion = nil
                    Task { await cloudStore.completeTaskListItem(record: request.record, item: request.item) }
                }
                Button("common.cancel", role: .cancel) { pendingTaskCompletion = nil }
            } message: { request in
                Text(String(
                    format: NSLocalizedString("cloud.task.complete.body", comment: ""),
                    request.item.text
                ))
            }
            .sheet(isPresented: $showMemoryComposer) {
                LifeOSMemoryComposer()
                    .environmentObject(cloudStore)
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
                Label("cloud.enable.connectionBoundary", systemImage: "network.slash")
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

            if cloudStore.totalMutationCount > 0 {
                Section {
                    if cloudStore.pendingMutationCount > 0 {
                        Label(
                            String(
                                format: NSLocalizedString("cloud.outbox.pending", comment: ""),
                                cloudStore.pendingMutationCount
                            ),
                            systemImage: "arrow.triangle.2.circlepath.icloud"
                        )
                    }
                    if cloudStore.reviewMutationCount > 0 {
                        Label(
                            String(
                                format: NSLocalizedString("cloud.outbox.review", comment: ""),
                                cloudStore.reviewMutationCount
                            ),
                            systemImage: "exclamationmark.triangle"
                        )
                        .foregroundStyle(.orange)
                    }
                    if cloudStore.otherAccountMutationCount > 0 {
                        Label(
                            String(
                                format: NSLocalizedString("cloud.outbox.otherAccount", comment: ""),
                                cloudStore.otherAccountMutationCount
                            ),
                            systemImage: "person.crop.circle.badge.exclamationmark"
                        )
                        .foregroundStyle(.orange)
                    }
                    if cloudStore.pendingMutationCount > 0 {
                        Button {
                            Task { await cloudStore.retryPendingMutations() }
                        } label: {
                            Label("cloud.outbox.retry", systemImage: "arrow.clockwise")
                        }
                        .disabled(cloudStore.isSyncing || cloudStore.isWriting)
                    }
                    Button(role: .destructive) {
                        confirmClearPending = true
                    } label: {
                        Label("cloud.outbox.clear.button", systemImage: "trash")
                    }
                    .disabled(cloudStore.isSyncing || cloudStore.isWriting)
                } header: {
                    Text("cloud.outbox.section")
                } footer: {
                    Text("cloud.outbox.footer")
                }
            }

            ForEach(groupedRecords, id: \.dataType) { group in
                Section(header: Text(sectionTitle(group.dataType))) {
                    ForEach(group.records.prefix(30)) { record in
                        cloudRecordRow(record)
                    }
                }
            }

            Section {
                Button("cloud.clear.button", role: .destructive) { confirmClear = true }
                    .disabled(cloudStore.isSyncing || cloudStore.isWriting)
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
    private func cloudRecordRow(_ record: LifeOSCloudRecord) -> some View {
        if record.recordType == "LifeOSTaskListSnapshot" && !record.taskItems.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                Text(record.displayTitle)
                    .font(.body.weight(.semibold))
                ForEach(record.taskItems) { item in
                    let queued = cloudStore.isTaskCompletionQueued(record: record, item: item)
                    HStack(alignment: .top, spacing: 11) {
                        Button {
                            guard !item.completed else { return }
                            pendingTaskCompletion = LifeOSPendingTaskCompletion(record: record, item: item)
                        } label: {
                            Image(systemName: item.completed ? "checkmark.circle.fill" : queued ? "clock.fill" : "circle")
                                .font(.title3)
                                .foregroundStyle(item.completed ? .mint : queued ? .orange : .cyan)
                                .frame(width: 28, height: 28)
                        }
                        .buttonStyle(.plain)
                        .disabled(
                            item.completed || queued || record.requiresUserReview || cloudStore.writingTaskRecordId != nil
                        )
                        .accessibilityLabel(Text(
                            item.completed ? "cloud.task.completed" : queued ? "cloud.task.queued" : "cloud.task.complete.accessibility"
                        ))
                        Text(item.text)
                            .font(.subheadline)
                            .foregroundStyle(item.completed ? .secondary : .primary)
                            .strikethrough(item.completed)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                }
            }
            .padding(.vertical, 4)
        } else {
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

private struct LifeOSMemoryComposer: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var cloudStore: LifeOSCloudDataStore
    @State private var title = ""
    @State private var text = ""
    @State private var confirmSave = false
    @State private var attemptedSave = false
    @State private var memoryId = "ios-memory-\(UUID().uuidString.lowercased())"

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            title.utf16.count <= LifeOSCloudMemoryMutationBuilder.maxTitleLength &&
            text.utf16.count <= LifeOSCloudMemoryMutationBuilder.maxTextLength &&
            !cloudStore.writingMemory
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("cloud.memory.form.title") {
                    TextField("cloud.memory.form.title.placeholder", text: $title)
                        .textInputAutocapitalization(.sentences)
                        .disabled(cloudStore.writingMemory)
                }
                Section {
                    ZStack(alignment: .topLeading) {
                        if text.isEmpty {
                            Text("cloud.memory.form.text.placeholder")
                                .foregroundStyle(.tertiary)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 8)
                        }
                        TextEditor(text: $text)
                            .frame(minHeight: 180)
                            .scrollContentBackground(.hidden)
                            .disabled(cloudStore.writingMemory)
                    }
                    Text(String(
                        format: NSLocalizedString("cloud.memory.form.counter", comment: ""),
                        text.utf16.count,
                        LifeOSCloudMemoryMutationBuilder.maxTextLength
                    ))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(text.utf16.count > LifeOSCloudMemoryMutationBuilder.maxTextLength ? Color.red : Color.secondary)
                } header: {
                    Text("cloud.memory.form.text")
                } footer: {
                    Label("cloud.memory.form.safe", systemImage: "lock.shield")
                }
                if cloudStore.writingMemory {
                    Section {
                        HStack(spacing: 10) {
                            ProgressView()
                            Text("cloud.memory.status.writing")
                                .foregroundStyle(.secondary)
                        }
                    }
                } else if attemptedSave && !cloudStore.statusMessage.isEmpty {
                    Section {
                        Label(cloudStore.statusMessage, systemImage: statusIcon)
                            .foregroundStyle(statusColor)
                        if cloudStore.nextAction != .none {
                            Button(LocalizedStringKey(cloudStore.nextAction.localizationKey)) {
                                Task { await cloudStore.performNextAction() }
                            }
                        }
                    }
                }
            }
            .navigationTitle(Text("cloud.memory.form.navigation"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("common.cancel") { dismiss() }
                        .disabled(cloudStore.writingMemory)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("cloud.memory.form.save") { confirmSave = true }
                        .disabled(!canSave)
                }
            }
            .alert("cloud.memory.confirm.title", isPresented: $confirmSave) {
                Button("cloud.memory.confirm.confirm") {
                    attemptedSave = true
                    Task {
                        if await cloudStore.createMemory(title: title, text: text, memoryId: memoryId) { dismiss() }
                    }
                }
                Button("common.cancel", role: .cancel) {}
            } message: {
                Text("cloud.memory.confirm.body")
            }
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

private struct LifeOSPendingTaskCompletion: Identifiable {
    let record: LifeOSCloudRecord
    let item: LifeOSCloudTaskItem
    var id: String { "\(record.id)/\(item.id)" }
}
