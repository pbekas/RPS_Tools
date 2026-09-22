# Fort Apache Surgery Center

Static site for [fortapachesc.com](https://fortapachesc.com).

## Live origin

https://deduk3joc88hk.cloudfront.net

Custom domain goes live after the Cloudflare DNS records below are added.

## Local preview

```bash
cd fortapachesc
python3 -m http.server 8080
```

## Redeploy

```bash
.venv/bin/python scripts/deploy_fortapachesc.py
```

## Cloudflare

1. Add ACM validation CNAMEs as **DNS-only** (grey cloud). Re-run the deploy script after the cert is issued to attach `fortapachesc.com`.
2. Point `fortapachesc.com` and `www` at `deduk3joc88hk.cloudfront.net` (orange cloud is fine).
3. Set SSL/TLS to **Full (strict)**. That clears the current 525 error.

No build step. Output is this folder as-is.
