// Guild-A launcher for the cluster-neutral site worker.
//
// The real worker logic now lives in deploy/site-worker/index.js, shared by
// every cluster - see that file's header comment. This file exists only so
// the production LXC (vmid 500, /opt/guildcloud-worker/index.js) keeps
// working unmodified: it reads Guild-A's identity from
// /etc/guildcloud/worker.env (see env.example in this directory) and hands
// off immediately.
//
// deploy-pull.sh's sparse-checkout must include deploy/site-worker/ as well
// as this directory for the import below to resolve on the LXC - see
// deploy/site-worker/README.md Task 8 (deploy packaging) for the
// generalized deploy script that ships both.
import "../site-worker/index.js";
