#!/bin/bash
# Sync OpenClaw fork with upstream and maintain ZEKE customizations
#
# Branch Strategy:
# - main: Synced with upstream openclaw/openclaw
# - zeke: ZEKE customizations (pendant, branding)
# - feature/*: Feature branches for specific work
#
# Usage:
#   ./scripts/sync-upstream.sh           # Sync main and rebase zeke
#   ./scripts/sync-upstream.sh --dry-run # Show what would be done
#   ./scripts/sync-upstream.sh --omi     # Also sync Omi reference fork

set -e

DRY_RUN=false
SYNC_OMI=false

for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --omi)
      SYNC_OMI=true
      shift
      ;;
    *)
      ;;
  esac
done

cd "$(dirname "$0")/.."
REPO_ROOT=$(pwd)

echo "=== OpenClaw Upstream Sync ==="
echo "Repository: $REPO_ROOT"
echo ""

# Check for uncommitted changes
if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "ERROR: Uncommitted changes detected. Please commit or stash before syncing."
  exit 1
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Ensure upstream remote exists
if ! git remote | grep -q "^upstream$"; then
  echo "Adding upstream remote..."
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would add: git remote add upstream https://github.com/openclaw/openclaw.git"
  else
    git remote add upstream https://github.com/openclaw/openclaw.git
  fi
fi

echo "Fetching upstream..."
if [ "$DRY_RUN" = true ]; then
  echo "[DRY-RUN] Would run: git fetch upstream"
else
  git fetch upstream
fi

# Sync main branch
echo ""
echo "=== Syncing main branch ==="
if [ "$DRY_RUN" = true ]; then
  echo "[DRY-RUN] Would run:"
  echo "  git checkout main"
  echo "  git merge upstream/main --no-edit"
  echo "  git push origin main"
else
  git checkout main
  git merge upstream/main --no-edit || {
    echo "ERROR: Merge conflict in main. Resolve manually."
    exit 1
  }
  git push origin main
fi

# Check if zeke branch exists
if git show-ref --verify --quiet refs/heads/zeke; then
  echo ""
  echo "=== Rebasing zeke branch ==="
  if [ "$DRY_RUN" = true ]; then
    echo "[DRY-RUN] Would run:"
    echo "  git checkout zeke"
    echo "  git rebase main"
    echo "  git push origin zeke --force-with-lease"
  else
    git checkout zeke
    git rebase main || {
      echo "ERROR: Rebase conflict in zeke. Resolve manually with:"
      echo "  git rebase --continue"
      echo "  # or"
      echo "  git rebase --abort"
      exit 1
    }
    git push origin zeke --force-with-lease
  fi
else
  echo "Note: zeke branch not found, skipping rebase."
fi

# Sync Omi reference fork if requested
if [ "$SYNC_OMI" = true ]; then
  OMI_DIR="$HOME/.openclaw/workspace/zeke-omi-fork"
  if [ -d "$OMI_DIR" ]; then
    echo ""
    echo "=== Syncing Omi reference fork ==="
    if [ "$DRY_RUN" = true ]; then
      echo "[DRY-RUN] Would run:"
      echo "  cd $OMI_DIR"
      echo "  git fetch upstream"
      echo "  git checkout main"
      echo "  git merge upstream/main --no-edit"
    else
      cd "$OMI_DIR"

      # Ensure upstream exists for Omi
      if ! git remote | grep -q "^upstream$"; then
        git remote add upstream https://github.com/BasedHardware/omi.git
      fi

      git fetch upstream
      git checkout main
      git merge upstream/main --no-edit || {
        echo "WARNING: Omi merge conflict. Resolve manually."
      }
    fi
  else
    echo "Note: Omi reference fork not found at $OMI_DIR"
  fi
fi

# Return to original branch
cd "$REPO_ROOT"
if [ "$DRY_RUN" = false ]; then
  git checkout "$CURRENT_BRANCH" 2>/dev/null || git checkout main
fi

echo ""
echo "=== Sync Complete ==="
if [ "$DRY_RUN" = true ]; then
  echo "(This was a dry run - no changes were made)"
fi
