#include <winsock2.h>
#include <windows.h>
#include <libssh2.h>
#include <libssh2_sftp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static SOCKET transport = INVALID_SOCKET;
static LIBSSH2_SESSION *session;
static LIBSSH2_SFTP *sftp;

static int fail(const char *step) {
    char *message = NULL;
    if (session) libssh2_session_last_error(session, &message, NULL, 0);
    fprintf(stderr, "SSH proof failed: %s (ssh=%d, sftp=%lu)\n", step,
            session ? libssh2_session_last_errno(session) : 0,
            sftp ? libssh2_sftp_last_error(sftp) : 0);
    if (message) fprintf(stderr, "%s\n", message);
    return 1;
}

static int trusted_host(void) {
    const char *expected = getenv("SSH_PROOF_HOST_SHA256");
    const unsigned char *hash = (const unsigned char *)libssh2_hostkey_hash(session, LIBSSH2_HOSTKEY_HASH_SHA256);
    char actual[65];
    if (!hash || !expected || strlen(expected) != 64) return 0;
    for (int i = 0; i < 32; ++i) sprintf(actual + i * 2, "%02x", hash[i]);
    // Hash originates from this run's fixture key, never TOFU or a user file.
    return memcmp(expected, actual, 64) == 0;
}

static int read_fixture(const char *path, const char *expected) {
    LIBSSH2_SFTP_HANDLE *handle = libssh2_sftp_open(sftp, path, LIBSSH2_FXF_READ, 0);
    if (!handle) return fail("open Unicode fixture");
    char bytes[128];
    size_t used = 0;
    ssize_t count;
    while ((count = libssh2_sftp_read(handle, bytes + used, sizeof(bytes) - used)) > 0) {
        used += (size_t)count;
        if (used == sizeof(bytes)) { libssh2_sftp_close(handle); return fail("fixture too large"); }
    }
    libssh2_sftp_close(handle);
    if (count < 0 || used != strlen(expected) || memcmp(bytes, expected, used)) return fail("Unicode content");
    puts("{\"check\":\"unicode-read\",\"ok\":true}");
    return 0;
}

static int check_directory(void) {
    LIBSSH2_SFTP_HANDLE *dir = libssh2_sftp_opendir(sftp, "/fixture");
    if (!dir) return fail("opendir");
    int saw_unicode = 0, saw_symlink = 0, count;
    char name[256];
    LIBSSH2_SFTP_ATTRIBUTES attributes;
    while ((count = libssh2_sftp_readdir(dir, name, sizeof(name), &attributes)) > 0) {
        if ((size_t)count == strlen("日本語.txt") && !memcmp(name, "日本語.txt", (size_t)count)) saw_unicode = 1;
        if (count == 4 && !memcmp(name, "link", 4) &&
            (attributes.flags & LIBSSH2_SFTP_ATTR_PERMISSIONS) && LIBSSH2_SFTP_S_ISLNK(attributes.permissions)) saw_symlink = 1;
    }
    libssh2_sftp_closedir(dir);
    if (count < 0 || !saw_unicode || !saw_symlink) return fail("directory Unicode/symlink attributes");
    char target[256];
    count = libssh2_sftp_readlink(sftp, "/fixture/link", target, sizeof(target));
    const char *expected = "/fixture/日本語.txt";
    if (count != (int)strlen(expected) || memcmp(target, expected, strlen(expected))) return fail("symlink target");
    puts("{\"check\":\"unicode-list-and-symlink\",\"ok\":true}");
    LIBSSH2_SFTP_HANDLE *denied = libssh2_sftp_open(sftp, "/denied", LIBSSH2_FXF_READ, 0);
    if (denied) { libssh2_sftp_close(denied); return fail("permission unexpectedly allowed"); }
    if (libssh2_sftp_last_error(sftp) != LIBSSH2_FX_PERMISSION_DENIED) return fail("permission error mapping");
    puts("{\"check\":\"permission-denied\",\"ok\":true}");
    return 0;
}

static int interrupted_read(int cancel) {
    LIBSSH2_SFTP_HANDLE *handle = libssh2_sftp_open(sftp, cancel ? "/slow" : "/disconnect", LIBSSH2_FXF_READ, 0);
    if (!handle) return fail("open interrupted fixture");
    libssh2_session_set_blocking(session, 0);
    char byte;
    ssize_t result;
    ULONGLONG started = GetTickCount64();
    do {
        result = libssh2_sftp_read(handle, &byte, 1);
        if (result != LIBSSH2_ERROR_EAGAIN) break;
        if (cancel) {
            // Parent sends cancellation only after the server has received the
            // pending READ. The harness deadline bounds this synchronization.
            if (getchar() != 'x') return fail("cancellation signal");
            // The proof cancellation policy aborts the owned transport. It does
            // not claim resumable transfer or product cancellation support.
            shutdown(transport, SD_BOTH);
            closesocket(transport);
            transport = INVALID_SOCKET;
            puts("{\"check\":\"cancel-closes-transport\",\"ok\":true}");
            return 0;
        }
        Sleep(5);
    } while (GetTickCount64() - started < 5000);
    if (result >= 0 || result == LIBSSH2_ERROR_EAGAIN) return fail("disconnect must fail within deadline");
    puts("{\"check\":\"disconnect-fails-within-deadline\",\"ok\":true}");
    return 0;
}

int ssh_proof_run(void) {
    const char *mode = getenv("SSH_PROOF_MODE");
    if (!mode) return fail("missing fixture mode");
    WSADATA data;
    if (WSAStartup(MAKEWORD(2, 2), &data)) return fail("WSAStartup");
    transport = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (transport == INVALID_SOCKET) { WSACleanup(); return fail("socket"); }
    DWORD timeout = 5000;
    setsockopt(transport, SOL_SOCKET, SO_RCVTIMEO, (const char *)&timeout, sizeof(timeout));
    setsockopt(transport, SOL_SOCKET, SO_SNDTIMEO, (const char *)&timeout, sizeof(timeout));
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_port = htons(19232);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int result = 1;
    if (connect(transport, (struct sockaddr *)&address, sizeof(address))) { fail("loopback connect"); goto done; }
    session = libssh2_session_init();
    if (!session) { fail("session allocation"); goto done; }
    libssh2_session_set_timeout(session, 5000);
    // Keep the fixture on SHA-2/RSA and AES-CTR supported by the WinCNG backend.
    if (libssh2_session_method_pref(session, LIBSSH2_METHOD_HOSTKEY, "rsa-sha2-256") ||
        libssh2_session_method_pref(session, LIBSSH2_METHOD_CRYPT_CS, "aes128-ctr") ||
        libssh2_session_method_pref(session, LIBSSH2_METHOD_CRYPT_SC, "aes128-ctr")) { fail("algorithm preference"); goto done; }
    if (libssh2_session_handshake(session, transport)) { fail("handshake"); goto done; }
    if (!trusted_host()) {
        if (!strcmp(mode, "changed-key") || !strcmp(mode, "unknown-key")) {
            puts("{\"check\":\"untrusted-key-blocked-before-auth\",\"ok\":true}");
            result = 0;
        } else fail("host key mismatch");
        goto done;
    }
    if (!strcmp(mode, "changed-key") || !strcmp(mode, "unknown-key")) { fail("untrusted key accepted"); goto done; }
    puts("{\"check\":\"trusted-key-before-auth\",\"ok\":true}");
    libssh2_userauth_list(session, "fixture", 7);
    if (!libssh2_userauth_authenticated(session)) { fail("fixture none authentication"); goto done; }
    sftp = libssh2_sftp_init(session);
    if (!sftp) { fail("SFTP subsystem"); goto done; }
    if (!strcmp(mode, "cancel") || !strcmp(mode, "disconnect")) result = interrupted_read(!strcmp(mode, "cancel"));
    else result = read_fixture("/fixture/日本語.txt", "Việt Nam 🧪\n") || check_directory();
done:
    // Session free releases SFTP handles. Nonblocking cleanup cannot await a
    // peer intentionally withholding an SFTP response or already disconnected.
    if (session) { libssh2_session_set_blocking(session, 0); libssh2_session_free(session); }
    if (transport != INVALID_SOCKET) closesocket(transport);
    WSACleanup();
    return result;
}
