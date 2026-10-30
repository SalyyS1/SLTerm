const std = @import("std");
const rpc = @import("protocol.zig");
const Provider = @import("provider-process.zig").Process;

const a = rpc.allocator;

const Entry = struct { id: u64, provider: ?*Provider };

/// Provider processes are independent from ConPTY sessions. The command loop
/// owns their map and only reaps stopped providers, while reader threads publish
/// ordered output through the same bounded core writer.
pub const Service = struct {
    entries: std.ArrayList(Entry) = .empty,

    pub fn deinit(self: *Service) void {
        for (self.entries.items) |entry| if (entry.provider) |provider| provider.destroy();
        self.entries.deinit(a);
    }

    pub fn stopAll(self: *Service) void {
        for (self.entries.items) |entry| if (entry.provider) |provider| provider.stop();
    }

    pub fn reap(self: *Service) void {
        for (self.entries.items) |*entry| {
            if (entry.provider) |provider| if (provider.hasExited()) {
                provider.destroy();
                entry.provider = null;
            };
        }
    }

    pub fn handle(self: *Service, req: rpc.Request, emitter: *rpc.Emitter) !bool {
        if (!std.mem.startsWith(u8, req.method, "provider.")) return false;
        self.reap();
        const id = req.provider_id orelse return error.MissingProviderId;
        const found = self.find(id);
        if (std.mem.eql(u8, req.method, "provider.start")) {
            if (found != null) return error.DuplicateProvider;
            const provider = try Provider.create(req, emitter);
            errdefer provider.destroy();
            try self.entries.append(a, .{ .id = id, .provider = provider });
            try emitter.ok(req.id);
            return true;
        }
        const entry = found orelse return error.UnknownProvider;
        const provider = entry.provider orelse return error.ProviderExited;
        if (std.mem.eql(u8, req.method, "provider.input")) {
            try provider.send(req.data orelse return error.MissingInput);
            try emitter.ok(req.id);
        } else if (std.mem.eql(u8, req.method, "provider.stop")) {
            provider.stop();
            try emitter.ok(req.id);
        } else return error.UnknownMethod;
        return true;
    }

    fn find(self: *Service, id: u64) ?*Entry {
        for (self.entries.items) |*entry| if (entry.id == id) return entry;
        return null;
    }
};
