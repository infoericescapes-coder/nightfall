#!/bin/bash
# Nightfall: export the existing iOS archive; no archive build or upload.
# Run with Eric present and full filesystem access. Signing functions below
# are ported from Simple Social scripts/release.sh per apple-signing-for-codex.md.
# No tracing: passwords travel through stdin/environment, never command argv.
set +x  # Disable inherited tracing before any signing secret is handled.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly DEVELOPER_DIR="/Applications/Xcode-27.app/Contents/Developer"
export DEVELOPER_DIR
NATIVE_IOS="$ROOT/native-ios"
ARCHIVE="$NATIVE_IOS/Nightfall.xcarchive"
EXPORT_PLIST="$NATIVE_IOS/ExportOptions.plist"
KEY_DIR="$HOME/private_keys"
DIST_DIR="$KEY_DIR/distribution"
DIST_KEY="$DIST_DIR/simplesocial-dist.key"
DIST_CER="$DIST_DIR/simplesocial-dist.cer"
DIST_WWDR="$DIST_DIR/AppleWWDRCAG3.cer"
RELEASE_KEYCHAIN=""
KC_TMP=""
RSYNC_SHIM_DIR=""
RELEASE_COMPLETED=0
SIGN_IDENTITY="Apple Distribution"
EXPECTED_AUTHORITY="Apple Distribution: Eric Kowalczyk (B3Z8GRN254)"
EXPECTED_IDENTITY_SHA1="7F10906FE961004F5693CDCD7D84C225F6B4017B"
TEAM="B3Z8GRN254"
VERSION="1.1.0"
BUILD_NUM="2"
NF_KEYCHAIN_AUDIT_STARTED=0
NF_KEYCHAINS_BEFORE=""
NF_EXIT_STATUS=1

fail() { echo "ERROR: $1" >&2; exit 1; }
usage() {
    echo "usage: scripts/release-ios.sh [EXPORT_DIRECTORY]" >&2
    echo "Export 1.1.0 (2) into a NEW ignored directory under native-ios." >&2
    echo "Default: native-ios/export-<timestamp>; existing paths are refused." >&2
}
if [[ $# -eq 1 && ( "$1" == "--help" || "$1" == "-h" ) ]]; then
    usage
    exit 0
fi
[[ $# -le 1 ]] || { usage; exit 2; }
[[ $# -eq 0 || "$1" != -* ]] || { usage; exit 2; }

# NIGHTFALL: validate the actual mktemp parent before creating ANY output or
# signing material. Preserve TMPDIR; the ported functions still consume it.
# A physical path check catches symlinks into this repository. Also refuse any
# other checkout, including worktrees whose .git entry is a file. Walk ancestors
# so an ownership/configuration refusal from Git cannot conceal a checkout.
NF_TMP_PARENT="$(cd "${TMPDIR:-/tmp}" && pwd -P)" \
    || fail "temporary-directory parent must already exist and be accessible"
[[ "$NF_TMP_PARENT" != "$ROOT" && "$NF_TMP_PARENT" != "$ROOT/"* ]] \
    || fail "temporary-directory parent must be outside the Nightfall repository"
NF_TMP_ANCESTOR="$NF_TMP_PARENT"
while :; do
    [[ ! -e "$NF_TMP_ANCESTOR/.git" && ! -L "$NF_TMP_ANCESTOR/.git" ]] \
        || fail "temporary-directory parent must be outside every Git checkout"
    [[ "$NF_TMP_ANCESTOR" != / ]] || break
    NF_TMP_ANCESTOR="$(dirname "$NF_TMP_ANCESTOR")"
done
# This also rejects a temporary parent inside the repository's Git directory
# or a bare repository, neither of which has a .git ancestor entry.
if git -C "$NF_TMP_PARENT" rev-parse --git-dir >/dev/null 2>&1; then
    fail "temporary-directory parent must be outside every Git repository"
fi

plist_assert() {
    local plist="$1" key="$2" expected="$3" actual
    [[ -f "$plist" ]] || fail "missing metadata: $plist"
    actual="$(/usr/libexec/PlistBuddy -c "Print :$key" "$plist")" \
        || fail "missing metadata $key in $plist"
    [[ "$actual" == "$expected" ]] \
        || fail "$key in $plist must be '$expected' (got '$actual')"
}
assert_bundle_metadata() {
    local bundle="$1" identifier="$2"
    [[ -d "$bundle" ]] || fail "missing bundle: $bundle"
    plist_assert "$bundle/Info.plist" CFBundleIdentifier "$identifier"
    plist_assert "$bundle/Info.plist" CFBundleShortVersionString "$VERSION"
    plist_assert "$bundle/Info.plist" CFBundleVersion "$BUILD_NUM"
}

# Refuse any plist that could upload or silently renumber this pinned archive.
[[ -d "$DEVELOPER_DIR" ]] || fail "required Xcode installation is missing: $DEVELOPER_DIR"
[[ -d "$ARCHIVE" ]] || fail "missing existing archive: $ARCHIVE"
plist_assert "$EXPORT_PLIST" destination export
plist_assert "$EXPORT_PLIST" method app-store-connect
plist_assert "$EXPORT_PLIST" manageAppVersionAndBuildNumber false
plist_assert "$EXPORT_PLIST" teamID "$TEAM"
[[ "${TEAM_ID:-$TEAM}" == "$TEAM" ]] || fail "TEAM_ID must be $TEAM"
plist_assert "$ARCHIVE/Info.plist" ApplicationProperties:Team "$TEAM"
plist_assert "$ARCHIVE/Info.plist" ApplicationProperties:ApplicationPath Applications/Nightfall.app
plist_assert "$ARCHIVE/Info.plist" ApplicationProperties:CFBundleIdentifier com.ericescapes.nightfall
plist_assert "$ARCHIVE/Info.plist" ApplicationProperties:CFBundleShortVersionString "$VERSION"
plist_assert "$ARCHIVE/Info.plist" ApplicationProperties:CFBundleVersion "$BUILD_NUM"
ARCHIVE_APP="$ARCHIVE/Products/Applications/Nightfall.app"
assert_bundle_metadata "$ARCHIVE_APP" com.ericescapes.nightfall
assert_bundle_metadata "$ARCHIVE_APP/PlugIns/Nightfall Extension.appex" com.ericescapes.nightfall.Extension

# Require an already-existing parent physically within the ignored native-ios
# tree. mkdir (below) claims the final directory atomically; never overwrite it.
NATIVE_IOS="$(cd "$NATIVE_IOS" && pwd -P)"
EXPORT_PATH="${1:-$NATIVE_IOS/export-$(date +%Y%m%d-%H%M%S)}"
[[ "$EXPORT_PATH" == /* ]] || EXPORT_PATH="$ROOT/$EXPORT_PATH"
[[ ! -e "$EXPORT_PATH" && ! -L "$EXPORT_PATH" ]] || fail "export output already exists: $EXPORT_PATH"
EXPORT_PARENT="$(cd "$(dirname "$EXPORT_PATH")" && pwd -P)" \
    || fail "export parent must already exist"
[[ "$EXPORT_PARENT" == "$NATIVE_IOS" || "$EXPORT_PARENT" == "$NATIVE_IOS/"* ]] \
    || fail "export output must be under native-ios"
EXPORT_NAME="$(basename "$EXPORT_PATH")"
[[ "$EXPORT_NAME" != '.' && "$EXPORT_NAME" != '..' && -n "$EXPORT_NAME" ]] \
    || fail "invalid export directory name"
EXPORT_PATH="$EXPORT_PARENT/$EXPORT_NAME"
git -C "$ROOT" check-ignore -q -- "$EXPORT_PATH/" \
    || fail "export output must be ignored by Git"

# Runtime discovery only: no caller overrides, no key/issuer values printed.
# The private key itself is read only by openssl/Xcode when they need it.
[[ -d "$KEY_DIR" ]] || fail "missing private key directory"
candidates=()
while IFS= read -r -d '' f; do candidates+=("$f"); done \
    < <(find "$KEY_DIR" -maxdepth 1 -name 'AuthKey_*.p8' -print0)
[[ ${#candidates[@]} -eq 1 ]] || fail "exactly one AuthKey_*.p8 is required in ~/private_keys"
KEY_PATH="${candidates[0]}"
[[ -f "$KEY_PATH" ]] || fail "ASC API key must be a file"
KEY_ID="$(basename "$KEY_PATH" .p8)"
KEY_ID="${KEY_ID#AuthKey_}"
[[ "$KEY_ID" =~ ^[A-Z0-9]{8,12}$ ]] || fail "ASC API key filename has an invalid key ID"
[[ -f "$KEY_DIR/issuer_id.txt" ]] || fail "missing ~/private_keys/issuer_id.txt"
ISSUER_ID="$(tr -d '[:space:]' < "$KEY_DIR/issuer_id.txt")"
[[ "$ISSUER_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] \
    || fail "issuer_id.txt must contain a UUID"
[[ -f "$DIST_KEY" ]] || fail "missing distribution private key: $DIST_KEY"
[[ -f "$DIST_CER" ]] || fail "missing distribution certificate: $DIST_CER"
[[ -f "$DIST_WWDR" ]] || fail "missing WWDR intermediate: $DIST_WWDR"

# RSYNC SHIM CLEANUP (LM10), defined up here because the ONE EXIT trap below
# calls it (see release_keychain_cleanup). NOTE the explicit `return 0`, and do
# not "simplify" this back to a `[[ ... ]] && rm -rf ...` one-liner. Under
# `set -e`, an EXIT trap whose last command returns non-zero REWRITES the
# script's exit status - so once the directory has already been removed the
# guard is false, the function returns 1, and a COMPLETELY SUCCESSFUL upload
# exits 1. That is the precise condition that started the 2026-07-12 ghost-build
# incident: a release that had in fact landed looking dead to its caller. Caught
# by the shim gate on 2026-08-26 before it ever ran a release.
cleanup_rsync_shim() {
    if [[ -n "${RSYNC_SHIM_DIR:-}" && -d "$RSYNC_SHIM_DIR" ]]; then
        rm -rf "$RSYNC_SHIM_DIR"
    fi
    return 0
}

# --- Disposable release keychain (LM17) -------------------------------------
# NIGHTFALL port (2026-10-03): source comments below retain Simple Social and
# Keto Stack review history. The lock/temp prefixes and NF_ names are local.
# PORTED 2026-09-27 from Keto Stack `scripts/release.sh` (the fleet reference,
# at ketostack fe24587), with only these changes: the KS_ names became NF_, the
# lock and temp paths say nightfall, the refusal names this app, the
# reference's `release_keychain_cleanup` body is now `release_keychain_teardown`
# (status passed in) behind a trap wrapper of the old name that also runs the
# LM10 shim cleanup and the LM11 completion check, and the keychain directory is
# resolved to its physical path. Each deviation is marked "NIGHTFALL" below. The BUILD nn / Rnn-xx / [Lnn] tags
# in the comments are Keto Stack's review ids and register rows, kept verbatim
# so the two copies still diff cleanly; they are not this repo's LM numbers.
#
# Built here, per run, and torn down by the EXIT trap whatever happens after.
# The password is random and lives only in this run.
#
# WHERE THE PASSWORD TRAVELS, COMMAND BY COMMAND (R10-A4 / R10-B5, build 26).
# It used to be expanded into child-process ARGV six times, which any local user
# can read out of `ps` for the life of the call, under a comment claiming it
# "lives only in this process". Two mechanisms replace it and each is named at its
# own line rather than claimed once at the top:
#
#   * openssl takes it through the ENVIRONMENT (`-passout env:NF_P12_PW`), set as
#     a one-command prefix so it is not in this script's own environment before or
#     after. On macOS another user's environment needs root to read, while another
#     user's argv does not, so this is a real narrowing and not a cosmetic one. It
#     is NOT "in-process": stated here so the next reader does not inherit the
#     claim that was wrong the first time.
#   * every `security` subcommand that takes the password takes it through
#     INTERACTIVE MODE (`security -i`), which reads the command line from stdin
#     and parses it itself, so the only argv is `security -i`. That is the four
#     password-bearing calls: create-keychain, unlock-keychain, import and
#     set-key-partition-list. The subcommands with nothing secret in them
#     (set-keychain-settings, list-keychains, find-identity, delete-keychain,
#     the WWDR import) stay on argv, because moving them would buy nothing and
#     hide what they do.
#
# ONE COMMAND PER `security -i`, AND IT IS MEASURED RATHER THAN ASSUMED.
# Interactive mode accepts a batch of commands on one stdin and exits with the
# status of the LAST one: `printf 'bogus\nlist-keychains -d user\n' | security -i`
# is exit 0 on this Mac, with the failure swallowed. A heredoc carrying all four
# calls would therefore have hidden exactly the failure class R10-B4 is about.
# Measured 2026-09-13 on Xcode 26.6 / macOS 26: a single failing command is 1 or
# 2, good-then-bad is 1, bad-then-good is 0.
#
# BUILD 29 (R12-A8). ONE LOCK ACROSS BOTH SEARCH-LIST EDITS.
#
# The list is read, filtered and written back in two places - `build_release_keychain`
# installs this run's entry, `release_keychain_cleanup` subtracts it - and each is a
# read/modify/write over a resource every release run on this Mac shares. Reading
# close to the write narrows the window and does not close it. Lane A's own
# interleaving, all four commands succeeding: run A's cleanup reads `[A, login]`; run
# B's setup writes `[B, A, login]`; run A writes the `[login]` it computed before B
# existed, and B's live keychain is off the list before B's export asks for it.
#
# `mkdir` is the atomic primitive here: this Mac's /bin/bash is 3.2.57 and has no
# `flock`. The wait is BOUNDED and the timeout FAILS rather than breaking the lock -
# a lock that breaks itself on a timer is not a lock, and the failure mode it would
# restore is the one this exists to remove. A stale lock after a kill -9 is a named
# residue with a one-line remedy, printed in the refusal.
NF_KEYCHAIN_LIST_LOCK="${TMPDIR:-/tmp}/nightfall-keychain-search-list.lock"

# BUILD 31 (P8, R13-A4 + R13-B3 + R13-A5). THE OWNERSHIP AND THE "DO I HOLD IT"
# ANSWER ARE ONE FACT ON DISK, so a signal cannot land between them.
#
# It used to be `mkdir` plus a shell variable, and the two changed in separate
# steps. Both gaps were measured against build 30 with this script's own extracted
# functions:
#
#   1. SIGNAL AFTER mkdir, BEFORE the flag (R13-B3). The directory existed, the flag
#      still said 0, and the EXIT trap looped `mkdir` against the directory THIS
#      process held: it blocked to the bound, printed the refusal, declined to touch
#      the search list and left the lock on disk. The build-29 wedge, restored.
#   2. SIGNAL AFTER rmdir, BEFORE the flag (R13-A4). The flag still said 1, so the
#      trap's acquire returned 0 AT ONCE against a lock ANOTHER run had since taken,
#      and would have read/modified/written the shared search list underneath it -
#      the lost-update class R12-A8 exists to close. Measured worse than reported:
#      the trap then RELEASED, removing the other run's lock directory.
#
# The remedy is not a third careful ordering, it is removing the second fact. The
# lock is a SYMLINK, which `ln -s` creates in one atomic syscall, and the link's
# TARGET is this run's own token. "Do I hold it" is `readlink`, so the answer is
# read from the thing itself and there is no window in which the two can disagree,
# whatever a signal does and wherever it lands.
#
# The token carries the PID, the second and a random, so a stale lock left by a
# `kill -9` can never be read as ours by a later run that happens to reuse the PID.
NF_KEYCHAIN_LIST_LOCK_TOKEN="nightfall.$$.$(date +%s).${RANDOM}"

# The wait ceiling, in seconds. A VARIABLE rather than a literal so the lock gate
# (Keto Stack's `scripts/release-lock-gate.sh`; no copy lives in this repo) can drive the SHIPPED functions to their timeout
# in seconds instead of two minutes: a gate that has to reproduce the constant in a
# copy of these functions is a gate on its own copy.
NF_KEYCHAIN_LIST_LOCK_WAIT="${NF_KEYCHAIN_LIST_LOCK_WAIT:-120}"

# Returns non-zero on timeout; the caller decides whether that is a failure (setup)
# or a reason to leave the list alone (cleanup).
#
# **IT IS RE-ENTRANT, AND THAT IS THE WHOLE OF THE BUILD-29 FIX-ROUND REPAIR.**
# `trap release_keychain_cleanup EXIT` is installed BEFORE `build_release_keychain`
# runs, and the cleanup's own critical section takes this same lock. Every `fail`
# path inside the setup's critical section releases first; a SIGNAL does not. So an
# ordinary Ctrl-C inside the ~1 s window between `search_list_lock_acquire` and
# `search_list_lock_release` used to send the EXIT trap looping `mkdir` against the
# directory THIS process already holds: two minutes of hanging, then the trap
# declining to touch the list, then the disposable keychain left FIRST in the user
# search list and on disk - the exact wedge `[L36]` and `[L68]` exist to prevent -
# and the lock directory outliving the process, so every later release run on this
# Mac waits another two minutes and then fails.
#
# A process cannot be blocked by itself, so the honest answer to "do you hold it" is
# yes, at once. It is NOT a counted lock: the only nesting this script has is the
# EXIT trap, nothing resumes the outer critical section after it, and a depth
# counter would leave the release's last act a `rmdir` it declines to perform.
search_list_lock_is_ours() {
    [[ "$(readlink "$NF_KEYCHAIN_LIST_LOCK" 2>/dev/null)" == "$NF_KEYCHAIN_LIST_LOCK_TOKEN" ]]
}

# **AN OCCUPIED LOCK PATH THAT IS NOT A SYMLINK IS REFUSED BY NAME** (BUILD 32,
# Q7; R15-A3, confirmed by execution).
#
# `ln -s TOKEN LOCK` onto a DIRECTORY exits 0 and creates `LOCK/TOKEN` INSIDE it
# rather than failing, which is documented behaviour and was measured on this Mac:
# exit 0, and the token appearing as a child. Build 30 held this lock as a
# `mkdir` DIRECTORY at the same path. So a build-30 run killed mid-hold leaves a
# directory that every later run's `ln -s` "acquires" - each with a differently
# named child, each returning 0 without owning anything, all of them entering the
# critical section that reads and replaces Eric's keychain search list together.
# `readlink` then fails on a directory, so `search_list_lock_release` declines and
# the directory outlives every run.
#
# The repair is a pre-flight rather than a rescue: the lock path is either absent,
# or it is a symlink whose target is a token. Anything else - a directory from the
# old format, a regular file, a symlink carrying another run's token - is refused
# with the path and the remedy, because breaking a lock this script did not make is
# exactly the removal-of-another-run's-lock that R13-A4 measured.
#
# It is deliberately NOT part of the wait loop: a stale SYMLINK is the documented
# fail-closed residue that the loop waits out and then names, and that behaviour is
# unchanged. This refuses only the shapes that cannot be a lock at all.
#
# **AND A SYMLINK POINTING AT A DIRECTORY IS NOT A LOCK EITHER** (BUILD 32 FIX
# ROUND; R15-A3's own reading, measured by the verifier). `-L` was the FIRST test
# and it returned 0, so a link to a directory sailed through the pre-flight and
# `ln -s` then resolved THROUGH the link and landed the token inside the target:
# `ACQUIRE rc=0 / OWNS no`, the R15-A3 defect verbatim, at the shape rather than at
# the instance. `-d` follows a symlink, so `-L path && -d path` is exactly "a link
# to a directory" and nothing else; a DANGLING link is still the documented
# fail-closed residue the wait loop waits out, unchanged.
#
# **AND A MISSING PARENT DIRECTORY IS NOT ANOTHER RUN** (BUILD 32 FIX ROUND). With
# no directory to create the link in, `ln -s` fails forever, the loop spent the
# whole bound on it and then printed "another Nightfall release run has held the
# lock", which is FALSE: nobody holds it and nobody can. A refusal that names the
# wrong cause sends the next person hunting a release that does not exist, so the
# parent is checked first and named.
search_list_lock_path_is_usable() {
    local parent
    parent="$(dirname "$NF_KEYCHAIN_LIST_LOCK")"
    if [[ ! -d "$parent" ]]; then
        echo "!!  the keychain search-list lock cannot be created: its directory does not" >&2
        echo "!!  exist ($parent). No release run is holding the lock - there is nowhere" >&2
        echo "!!  to put one. Create that directory, or set TMPDIR to one that exists," >&2
        echo "!!  then try again." >&2
        return 1
    fi
    if [[ -L "$NF_KEYCHAIN_LIST_LOCK" ]]; then
        if [[ -d "$NF_KEYCHAIN_LIST_LOCK" ]]; then
            echo "!!  the keychain search-list lock path is a link to a directory, not a lock" >&2
            echo "!!  ($NF_KEYCHAIN_LIST_LOCK). A symlink created there would resolve THROUGH" >&2
            echo "!!  the link and land inside that directory, owning nothing, exactly as a" >&2
            echo "!!  surviving pre-build-31 lock directory does. Remove it by hand once no" >&2
            echo "!!  release is running, then try again." >&2
            return 1
        fi
        return 0
    fi
    if [[ ! -e "$NF_KEYCHAIN_LIST_LOCK" ]]; then
        return 0
    fi
    local what="a file"
    [[ -d "$NF_KEYCHAIN_LIST_LOCK" ]] && what="a directory"
    echo "!!  the keychain search-list lock path is $what, not a lock" >&2
    echo "!!  ($NF_KEYCHAIN_LIST_LOCK). A release before build 31 held this lock as a" >&2
    echo "!!  directory; one killed mid-run leaves it behind, and a symlink created" >&2
    echo "!!  at that path would land INSIDE it and own nothing. Remove it by hand" >&2
    echo "!!  once no release is running, then try again." >&2
    return 1
}

search_list_lock_acquire() {
    if search_list_lock_is_ours; then
        return 0
    fi
    search_list_lock_path_is_usable || return 1
    local waited=0
    until ln -s "$NF_KEYCHAIN_LIST_LOCK_TOKEN" "$NF_KEYCHAIN_LIST_LOCK" 2>/dev/null; do
        # Re-checked inside the loop: a directory can appear at the path while this
        # run is waiting on an ordinary stale symlink, and a check that only runs
        # once would then spend the whole bound failing for a reason it could name
        # in the first second.
        search_list_lock_path_is_usable || return 1
        if [[ "$waited" -ge "$NF_KEYCHAIN_LIST_LOCK_WAIT" ]]; then
            # The seconds are READ from the bound rather than spelled: the message
            # said "over two minutes" while the wait became a variable one line up,
            # which is a lying instrument for the price of one interpolation.
            echo "!!  another Nightfall release run has held the keychain search-list lock" >&2
            echo "!!  ($NF_KEYCHAIN_LIST_LOCK) for over ${NF_KEYCHAIN_LIST_LOCK_WAIT}s. If no release is running," >&2
            echo "!!  remove that link and try again." >&2
            return 1
        fi
        sleep 1
        waited=$((waited + 1))
    done
    search_list_lock_verify_ownership || return 1
    return 0
}

# **`ln -s` SUCCEEDING IS NOT OWNERSHIP, AND THE PATH IS RE-READ AFTER IT** (BUILD
# 33, R15; R16-A5, static-only, reproduced by Keto Stack's `scripts/release-lock-gate.sh`).
#
# The pre-flight and the in-loop re-check above both run where `ln -s` FAILS. This
# run waits on another run's ordinary symlink and sleeps; the holder releases, and
# before the next attempt a DIRECTORY (a pre-build-31 lock), or a link to one,
# appears at the path. `ln -s` then SUCCEEDS by creating `LOCK/TOKEN` inside it, the
# loop exits, and the acquire used to return 0 owning nothing: the R15-A3 defect at
# the transition rather than at the instance. Measured on the build-32 functions:
# `ACQUIRE rc=0 / OWNS no / INSIDE 1`.
#
# So ownership is READ, from the thing itself, after the link is made. Where it is
# not ours, the link this run made inside the new shape is removed - only a link
# named with THIS run's token and pointing at it, which nobody else can have made -
# and the path is refused with what it is and the remedy, through the same
# predicate the pre-flight uses, so the two cannot describe one shape two ways.
search_list_lock_verify_ownership() {
    search_list_lock_is_ours && return 0
    local stray="$NF_KEYCHAIN_LIST_LOCK/$NF_KEYCHAIN_LIST_LOCK_TOKEN"
    if [[ -L "$stray" && "$(readlink "$stray" 2>/dev/null)" == "$NF_KEYCHAIN_LIST_LOCK_TOKEN" ]]; then
        rm -f "$stray" 2>/dev/null
    fi
    if search_list_lock_path_is_usable; then
        echo "!!  the keychain search-list lock ($NF_KEYCHAIN_LIST_LOCK) changed while this" >&2
        echo "!!  run was waiting for it, and the link this run made did not become the" >&2
        echo "!!  lock. Remove it by hand once no release is running, then try again." >&2
    fi
    return 1
}

# It releases only where THIS run holds the lock, which `readlink` answers rather
# than a flag: a trap that dropped somebody else's lock is the state R13-A4 measured.
#
# **A FAILED REMOVAL IS REPORTED, NOT SILENCED** (R13-A5). It used to be
# `rmdir 2>/dev/null` followed unconditionally by clearing the flag, so a removal
# that failed produced an apparent release: the lock survived with no message and
# every later release run waited out the bound and then failed. The removal is
# verified against the filesystem and the refusal names the path and the remedy.
search_list_lock_release() {
    search_list_lock_is_ours || return 0
    rm -f "$NF_KEYCHAIN_LIST_LOCK" 2>/dev/null
    if [[ -L "$NF_KEYCHAIN_LIST_LOCK" ]]; then
        echo "!!  could not remove the keychain search-list lock" >&2
        echo "!!  ($NF_KEYCHAIN_LIST_LOCK). Remove it by hand: every later release run" >&2
        echo "!!  on this Mac will wait ${NF_KEYCHAIN_LIST_LOCK_WAIT}s on it and then fail." >&2
        return 1
    fi
    return 0
}

#
# BUILD 29 (R12-A7/B1, R12-A8). THE EXIT TRAP STOPS BEING THE SILENT HALF OF THE
# SCRIPT. Three things were wrong with it and all three are the same shape as the
# build-time read this cycle fixed one function down.
#
#   1. The search-list READ was still a process substitution with stderr
#      discarded, so its exit status belonged to a subshell `set -euo pipefail`
#      never looks at. Make securityd unavailable while the script exits: the read
#      fails with no stdout, `remaining` stays empty, the list edit is SKIPPED -
#      and the `delete-keychain` on the next line still runs, so the user search
#      list goes on naming a file that no longer exists. That is `[L68]`'s own
#      sentence arriving one function down, which is `[L71]`'s class exactly:
#      closing an instance is not closing the class.
#   2. `delete-keychain`'s status was discarded too, so a run could fail to remove
#      its own keychain and say nothing at all.
#   3. `rm -rf "$KC_TMP"` destroyed the backing directory whether or not the
#      registration had come off, which turns a recoverable state (a list naming a
#      file that exists) into an unrecoverable one.
#
# AND THE TRAP MUST NOT CHANGE THE RUN'S EXIT STATUS. An EXIT trap runs with `$?`
# from the exiting command; every diagnostic below is printed and the original
# status is restored on the way out, so a failed archive still exits non-zero and
# a clean run still exits 0 even when the cleanup had something to say.
release_keychain_cleanup() {
    local status=$?
    set +e
    # NIGHTFALL: THE ONE EXIT TRAP (port deviation, 2026-09-27). The Keto Stack
    # body is `release_keychain_teardown` below, unchanged except that it takes the
    # status as an argument; this wrapper adds three things around it.
    #
    # 1. `trap` REPLACES, it does not append. The LM10 shim used to install its own
    #    `trap cleanup_rsync_shim EXIT` after the archive, which would now silently
    #    evict the keychain teardown for the whole export stage. So the shim cleanup
    #    is CALLED here and the shim no longer traps. It ends in `return 0` (LM11)
    #    and touches nothing the teardown reads.
    cleanup_rsync_shim
    # 2. LM11, SHARPER HALF, NOW LOAD-BEARING. On this Mac's /bin/bash 3.2.57 a
    #    `set -u` abort under ANY EXIT trap arrives here with $? == 0 (measured
    #    2026-09-27: `set -u; trap f EXIT; echo "$UNSET"` exits 0 where the
    #    untrapped script exits 1). This trap is installed before the keychain
    #    build, so that window is the whole archive and upload. Every deliberate
    #    zero exit below the trap sets RELEASE_COMPLETED=1 first; a zero status
    #    WITHOUT it is an abort bash disguised as success, and it becomes a failure.
    if [[ "$status" -eq 0 && "${RELEASE_COMPLETED:-0}" != "1" ]]; then
        echo "!!  release-ios.sh exited 0 WITHOUT reaching a completion point: this is an" >&2
        echo "!!  aborted run that bash 3.2 reported as success (LM11). Exiting 1. Read the" >&2
        echo "!!  log above for the real error before doing anything else (LM2: never re-run blind)." >&2
        status=1
    fi
    release_keychain_teardown "$status"
    # NIGHTFALL: audit only; never restore the captured search-list snapshot.
    nightfall_cleanup_audit "$status"
    status="$NF_EXIT_STATUS"
    # 3. The status is set with `exit`, not `return`. Measured 2026-09-27 on bash
    #    3.2.57: once a trap function has run `set +e`, its RETURN value is ignored
    #    and the script exits with the original status (so the reference's
    #    `return $status` preserves the status only because it never differs from
    #    it); `exit N` inside the trap is what the script actually reports. `exit`
    #    here also preserves every ordinary status unchanged (exit 3 stays 3, a
    #    `set -e` failure stays 1), so the only status it ever changes is the
    #    disguised abort above. NIGHTFALL also fails a successful run if the
    #    cleanup/audit wrapper detects residue or a changed search list.
    exit "$status"
}
release_keychain_teardown() {
    local status="$1"
    set +e
    # **ONLY THIS RUN'S ENTRY COMES OFF THE CURRENT LIST** (R10-A7, build 26).
    # This used to restore a SNAPSHOT taken at build time, which is a write of
    # somebody else's state: two overlapping runs each snapshot a list containing
    # the other, the first to exit restores a list without the second's keychain
    # (breaking its export), and the second later restores a list naming a
    # keychain the first has already deleted. The list is a shared, mutable,
    # user-level resource and the only safe edit is a subtraction of our own path
    # from whatever it says NOW.
    local removed_registration=0
    if [[ -n "$RELEASE_KEYCHAIN" ]]; then
        # The read and the write are ONE critical section (R12-A8), under the same
        # lock `build_release_keychain` takes: a subtraction computed from a list
        # another run has already replaced is the interleaving this closes.
        if ! search_list_lock_acquire; then
            echo "!!  could not take the keychain search-list lock at exit; leaving the list" >&2
            echo "!!  alone and KEEPING $RELEASE_KEYCHAIN." >&2
            return $status
        fi
        # A COMMAND whose status is checked, never a redirection (`[L68]`), and
        # stderr is KEPT: the whole defect was a read that failed quietly.
        local listing=""
        if ! listing="$(security list-keychains -d user)"; then
            search_list_lock_release
            echo "!!  could not read the user keychain search list at exit; leaving it alone." >&2
            echo "!!  KEEPING $RELEASE_KEYCHAIN so the list never names a file that is gone." >&2
            echo "!!  Remove it by hand once securityd answers again." >&2
            return $status
        fi
        local remaining=() entry
        while IFS= read -r entry; do
            entry="${entry#"${entry%%[![:space:]]*}"}"   # leading space
            entry="${entry%\"}"; entry="${entry#\"}"      # the quotes security prints
            [[ -z "$entry" ]] && continue
            [[ "$entry" == "$RELEASE_KEYCHAIN" ]] && continue
            remaining+=("$entry")
        done <<< "$listing"
        # An empty result is never written: `-s` with no keychains sets an EMPTY
        # search list, which would leave the Mac unable to find the login
        # keychain. An empty answer here is the same refusal the build-time read
        # makes, for the same reason, and it KEEPS the keychain.
        if [[ ${#remaining[@]} -eq 0 ]]; then
            search_list_lock_release
            echo "!!  the user keychain search list read back with nothing but this run's own" >&2
            echo "!!  keychain in it; refusing to write an empty list. KEEPING $RELEASE_KEYCHAIN." >&2
            return $status
        fi
        if security list-keychains -d user -s "${remaining[@]}"; then
            removed_registration=1
            search_list_lock_release
        else
            search_list_lock_release
            echo "!!  could not remove $RELEASE_KEYCHAIN from the user keychain search list." >&2
            echo "!!  KEEPING the keychain file so the list never names a file that is gone." >&2
            return $status
        fi
    fi
    # **The file comes off only once the REGISTRATION is confirmed gone.** The
    # order is the whole point: a list naming a keychain that exists is an
    # anomaly, and a list naming a keychain that does not is a wedge.
    if [[ -n "$RELEASE_KEYCHAIN" && -f "$RELEASE_KEYCHAIN" && "$removed_registration" -eq 1 ]]; then
        if ! security delete-keychain "$RELEASE_KEYCHAIN"; then
            echo "!!  could not delete the disposable keychain $RELEASE_KEYCHAIN." >&2
            echo "!!  It is off the search list; remove the file by hand." >&2
            return $status
        fi
    fi
    if [[ -n "$KC_TMP" && -d "$KC_TMP" && "$removed_registration" -eq 1 ]]; then
        rm -rf "$KC_TMP"
    fi
    return $status
}
build_release_keychain() {
    KC_TMP="$(mktemp -d "${TMPDIR:-/tmp}/nightfall-release-kc.XXXXXX")"
    chmod 700 "$KC_TMP"
    # NIGHTFALL: THE PATH IS SPELLED THE WAY `security` WILL SPELL IT BACK
    # (port deviation, 2026-09-27; the reference carries the same latent gap).
    # macOS TMPDIR ends in a slash and lives under /var, a symlink to /private/var,
    # so mktemp returns `.../T//nightfall-release-kc.X` while
    # `security list-keychains` prints `/private/var/.../T/nightfall-release-kc.X`.
    # The cleanup subtracts this run's entry by EXACT string match, so with the raw
    # path it matched nothing and wrote the list back WITH this keychain still in
    # it; only `delete-keychain`'s own search-list side effect removed it (measured
    # with a pass-through spy on every `list-keychains -s` write, both TMPDIR
    # shapes). The physical path makes the subtraction do the work it claims.
    KC_TMP="$(cd "$KC_TMP" && pwd -P)" || fail "could not resolve the disposable keychain directory"
    RELEASE_KEYCHAIN="$KC_TMP/release.keychain-db"
    local pw p12
    pw="$(openssl rand -hex 24)"
    p12="$KC_TMP/dist-identity.p12"
    # stdin, not argv.
    printf 'create-keychain -p "%s" "%s"\n' "$pw" "$RELEASE_KEYCHAIN" | security -i \
      || fail "could not create the disposable release keychain"
    # No password in this one, so it stays on argv where a reader can see it.
    security set-keychain-settings -lut 21600 "$RELEASE_KEYCHAIN"
    # stdin, not argv.
    printf 'unlock-keychain -p "%s" "%s"\n' "$pw" "$RELEASE_KEYCHAIN" | security -i \
      || fail "could not unlock the disposable release keychain"
    # PKCS12 from the PEM key + DER cert so `security import` gets one complete identity.
    # The password rides in the ENVIRONMENT of these two calls and nowhere else.
    # NIGHTFALL: the signing contract requires WWDR DER-to-PEM conversion and
    # the same complete chain in the non-legacy fallback.
    NF_P12_PW="$pw" openssl pkcs12 -export -inkey "$DIST_KEY" \
        -in <(openssl x509 -inform DER -in "$DIST_CER") \
        -certfile <(openssl x509 -inform DER -in "$DIST_WWDR") -legacy -passout env:NF_P12_PW -out "$p12" 2>/dev/null \
      || NF_P12_PW="$pw" openssl pkcs12 -export -inkey "$DIST_KEY" \
        -in <(openssl x509 -inform DER -in "$DIST_CER") \
        -certfile <(openssl x509 -inform DER -in "$DIST_WWDR") \
        -passout env:NF_P12_PW -out "$p12"
    # stdin, not argv. One command, for the batch-status reason above.
    printf 'import "%s" -k "%s" -P "%s" -f pkcs12 -T /usr/bin/codesign -T /usr/bin/security -T /usr/bin/productbuild -A\n' \
        "$p12" "$RELEASE_KEYCHAIN" "$pw" | security -i >/dev/null \
      || fail "could not import the distribution identity into the disposable keychain"
    security import "$DIST_WWDR" -k "$RELEASE_KEYCHAIN" -T /usr/bin/codesign >/dev/null 2>&1 || true
    # **The line that removes the prompt, and its status is now LOAD-BEARING**
    # (R10-B4, build 26). It was `>/dev/null 2>&1` with no status check, so an ACL
    # failure, a locked keychain or a `security` error printed nothing and the run
    # walked straight into `xcodebuild archive`, where codesign blocks on a UI
    # prompt no headless run can answer: the exact failure this call exists to
    # prevent, arriving silently. stdout stays quiet (it is chatty and says
    # nothing), stderr is left alone, and a non-zero status fails the run.
    printf 'set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "%s" "%s"\n' \
        "$pw" "$RELEASE_KEYCHAIN" | security -i >/dev/null \
      || fail "set-key-partition-list failed: codesign would block on a keychain prompt"
    rm -f "$p12"
    # First in the user search list for this run only (the export step resolves
    # the identity through the search list, not through --keychain). The list is
    # read HERE and used HERE; nothing is kept for a later restore, because a
    # snapshot held across a run is a promise about somebody else's state (A7).
    #
    # **AN UNREADABLE LIST FAILS THE RUN, AND IT USED TO BE AUTHORITY TO REPLACE
    # IT** (R11-A3, build 27). The read was the process substitution feeding this
    # loop, so its exit status belonged to a subshell `set -euo pipefail` never
    # looks at: a `security list-keychains -d user` that exited non-zero with no
    # stdout left `current` empty, and the empty branch below then wrote a list
    # holding ONLY this run's disposable keychain. The user's login keychain is out
    # of the search list at that moment; the EXIT trap subtracts this run's path
    # from the list as it now stands, finds nothing left, declines to write an empty
    # list by design - and deletes the keychain. The Mac is left with a user search
    # list that names a file that no longer exists, and no login keychain, from a
    # release run that printed one line to stderr.
    #
    # So the read is a COMMAND whose status is checked, and an empty answer is a
    # refusal rather than a licence. The login keychain is in every list a working
    # Mac returns; a list that comes back empty is a read this script did not
    # understand, and the only safe thing to do with a shared, mutable, user-level
    # resource you cannot read is to leave it alone and say why. (The membership is
    # not asserted BY NAME: a non-empty answer IS the user's list, whatever it is
    # called, and demanding the literal `login.keychain-db` would stop a Mac whose
    # list is legitimately different for a reason that is not this defect.)
    # The read and the write below are ONE critical section (R12-A8). Without the
    # lock, this run's `-s` can land between another run's cleanup read and its
    # cleanup write, and that write then removes this run's live keychain.
    search_list_lock_acquire \
      || fail "could not take the keychain search-list lock; another release run is holding it"
    local listing=""
    listing="$(security list-keychains -d user)" \
      || { search_list_lock_release; \
           fail "could not read the user keychain search list; refusing to replace it"; }
    local current=() entry
    while IFS= read -r entry; do
        entry="${entry#"${entry%%[![:space:]]*}"}"
        entry="${entry%\"}"; entry="${entry#\"}"
        [[ -n "$entry" ]] && current+=("$entry")
    done <<< "$listing"
    # Measured on this Mac's /bin/bash 3.2.57: under `set -u`, "${arr[@]}" on an
    # EMPTY array is `unbound variable` and aborts, while ${#arr[@]} is safe. The
    # empty case is therefore still BRANCHED (Switch EF-5) - it just stops being a
    # branch that WRITES.
    [[ ${#current[@]} -gt 0 ]] \
      || { search_list_lock_release; \
           fail "the user keychain search list read back empty; refusing to replace it with this run's disposable keychain"; }
    security list-keychains -d user -s "$RELEASE_KEYCHAIN" "${current[@]}" \
      || { search_list_lock_release; fail "could not install this run's keychain in the search list"; }
    search_list_lock_release
    local n
    n="$(security find-identity -v -p codesigning "$RELEASE_KEYCHAIN" | grep -c "$SIGN_IDENTITY" || true)"
    [[ "$n" -ge 1 ]] || fail "disposable keychain holds no '$SIGN_IDENTITY' identity (check $DIST_DIR)"
    echo "    keychain      disposable, $n '$SIGN_IDENTITY' identity, torn down on exit"
}

# NIGHTFALL: additional assertions wrap the port, rather than weakening its
# teardown subtraction. The snapshot below is audit evidence, NEVER a restore.
nightfall_cleanup_audit() {
    NF_EXIT_STATUS="$1"
    local failed=0 after=""
    if ! search_list_lock_release; then
        failed=1
    fi
    if [[ -n "$KC_TMP" && -d "$KC_TMP" ]]; then
        echo "!!  disposable keychain directory remains: $KC_TMP; inspect cleanup diagnostics above." >&2
        failed=1
    fi
    if [[ -n "$RSYNC_SHIM_DIR" && -d "$RSYNC_SHIM_DIR" ]]; then
        echo "!!  rsync shim cleanup failed: $RSYNC_SHIM_DIR" >&2
        failed=1
    fi
    if [[ "$NF_KEYCHAIN_AUDIT_STARTED" -eq 1 ]]; then
        if after="$(security list-keychains -d user)"; then
            echo "==> User keychain search list AFTER (audit only)"
            printf '%s\n' "$after"
            if [[ "$after" != "$NF_KEYCHAINS_BEFORE" ]]; then
                echo "!!  keychain search list differs from BEFORE; failing audit without restoring a snapshot." >&2
                failed=1
            fi
        else
            echo "!!  could not read the AFTER keychain search list; audit failed." >&2
            failed=1
        fi
    fi
    # Preserve every original nonzero status. Cleanup/audit can only turn success
    # into failure; a teardown diagnostic must never hide an export failure.
    if [[ "$failed" -eq 1 && "$NF_EXIT_STATUS" -eq 0 ]]; then
        NF_EXIT_STATUS=1
    fi
    return 0
}
assert_distribution_identity() {
    local identities count matching
    identities="$(security find-identity -v -p codesigning "$RELEASE_KEYCHAIN")" \
        || fail "could not read disposable signing identities"
    count="$(printf '%s\n' "$identities" | awk '/^[[:space:]]*[0-9]+\)/ {n++} END {print n+0}')"
    matching="$(printf '%s\n' "$identities" | awk -v sha="$EXPECTED_IDENTITY_SHA1" -v name="$EXPECTED_AUTHORITY" '
        /^[[:space:]]*[0-9]+\)/ {
            identity=$0; sub(/^[^"]*"/, "", identity); sub(/"[[:space:]]*$/, "", identity)
            if ($2 == sha && identity == name) n++
        } END {print n+0}')"
    [[ "$count" == 1 && "$matching" == 1 ]] \
        || fail "disposable keychain must have exactly one valid identity matching the pinned distribution certificate"
    echo "==> Distribution identity matches the pinned certificate"
}
assert_exported_signature() {
    local bundle="$1" details
    details="$(codesign -dvv "$bundle" 2>&1)" \
        || fail "could not display exported signature: $bundle"
    printf '%s\n' "$details"
    printf '%s\n' "$details" | grep -Fx "Authority=$EXPECTED_AUTHORITY" >/dev/null \
        || fail "exported bundle has an unexpected signing authority: $bundle"
    codesign --verify --strict --verbose=2 "$bundle" \
        || fail "exported signature verification failed: $bundle"
}

# One EXIT trap, installed BEFORE either temporary signing asset is created.
# INT/TERM deliberately exit nonzero through that same teardown path.
trap release_keychain_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
NF_KEYCHAINS_BEFORE="$(security list-keychains -d user)" \
    || fail "could not read the BEFORE user keychain search list"
[[ "$NF_KEYCHAINS_BEFORE" =~ [^[:space:]] ]] \
    || fail "BEFORE user keychain search list is empty; refusing to sign"
NF_KEYCHAIN_AUDIT_STARTED=1
echo "==> User keychain search list BEFORE (audit only)"
printf '%s\n' "$NF_KEYCHAINS_BEFORE"
mkdir "$EXPORT_PATH" || fail "could not claim a fresh export directory: $EXPORT_PATH"

echo "==> Building the disposable release keychain"
build_release_keychain
assert_distribution_identity

# RSYNC SHIM (2026-08-26 incident), ported from Simple Social. Xcode's export
# resolves rsync through PATH; the Homebrew version can fail with "Copy failed".
# Prepend exactly ONE symlink for this export command, preserving the rest of PATH.
RSYNC_SHIM_DIR="$(mktemp -d "${TMPDIR:-/tmp}/nightfall-rsync-shim.XXXXXX")"
[[ -x /usr/bin/rsync ]] || fail "/usr/bin/rsync is missing; the export shim cannot be built"
ln -s /usr/bin/rsync "$RSYNC_SHIM_DIR/rsync"
echo "==> Exporting Nightfall $VERSION ($BUILD_NUM)"
PATH="$RSYNC_SHIM_DIR:$PATH" xcodebuild -exportArchive \
    -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$EXPORT_PLIST" \
    -exportPath "$EXPORT_PATH" \
    -allowProvisioningUpdates \
    -authenticationKeyPath "$KEY_PATH" \
    -authenticationKeyID "$KEY_ID" \
    -authenticationKeyIssuerID "$ISSUER_ID"

# Validate the actual IPA payload, including the embedded Safari extension.
# Keep it inside the fresh ignored output for review; no upload is performed.
ipas=()
while IFS= read -r -d '' f; do ipas+=("$f"); done \
    < <(find "$EXPORT_PATH" -maxdepth 1 -type f -name '*.ipa' -print0)
[[ ${#ipas[@]} -eq 1 ]] || fail "export must produce exactly one IPA"
VERIFICATION_DIR="$EXPORT_PATH/signature-verification"
mkdir "$VERIFICATION_DIR"
/usr/bin/ditto -x -k "${ipas[0]}" "$VERIFICATION_DIR"
EXPORTED_APP="$VERIFICATION_DIR/Payload/Nightfall.app"
EXPORTED_EXTENSION="$EXPORTED_APP/PlugIns/Nightfall Extension.appex"
assert_bundle_metadata "$EXPORTED_APP" com.ericescapes.nightfall
assert_bundle_metadata "$EXPORTED_EXTENSION" com.ericescapes.nightfall.Extension
assert_exported_signature "$EXPORTED_APP"
assert_exported_signature "$EXPORTED_EXTENSION"
echo "==> Export and signature checks completed: ${ipas[0]}"
echo "    Export output: $EXPORT_PATH"
# The EXIT trap still must finish teardown and the exact before/after audit.
RELEASE_COMPLETED=1
