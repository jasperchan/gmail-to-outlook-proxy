#!/bin/bash
# run by deploy/systemd/sendas-daily.timer
dir="$(dirname "$0")"
status=0
"$dir/renew-certs.sh" || status=$?
"$dir/backup.sh" || status=$?
exit $status
