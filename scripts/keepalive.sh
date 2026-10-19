#!/usr/bin/env bash
# GitHub disables scheduled workflows in a public repo after 60 days with no repository activity.
# If main's newest commit is at least KEEPALIVE_DAYS old (default 50), push one empty commit to reset
# that timer. Otherwise do nothing. Pushes made with the Actions token do not trigger other workflows.
set -euo pipefail
days="${KEEPALIVE_DAYS:-50}"
branch="${KEEPALIVE_BRANCH:-main}"
git fetch -q --depth=1 origin "$branch"
last=$(git log -1 --format=%ct FETCH_HEAD)
age=$(( ( $(date +%s) - last ) / 86400 ))
echo "newest commit on $branch is $age days old (threshold $days)"
if [ "$age" -lt "$days" ]; then
  echo "recent activity; no keep-alive commit needed"
  exit 0
fi
git -c user.name=apex-bot -c user.email=apex-bot@users.noreply.github.com \
  commit-tree "FETCH_HEAD^{tree}" -p FETCH_HEAD -m "chore: keep scheduled workflows active (no commits for $age days)" > .keepalive-sha
if git push -q origin "$(cat .keepalive-sha):refs/heads/$branch"; then
  echo "pushed keep-alive commit $(cut -c1-7 .keepalive-sha)"
else
  echo "$branch moved while this ran; that new commit already counts as activity"
fi
rm -f .keepalive-sha
