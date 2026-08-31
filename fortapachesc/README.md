# Fort Apache Surgery Center

Static site for [fortapachesc.com](https://fortapachesc.com).

## Local preview

```bash
cd fortapachesc
python3 -m http.server 8080
```

Open http://localhost:8080

## Cloudflare

1. Upload this folder to Cloudflare Pages, or connect a repo with the project root set to `fortapachesc`.
2. Point `fortapachesc.com` at the Pages project (CNAME or custom domain in Cloudflare).
3. Add `www` as a redirect if you want it.

No build step. Output is this folder as-is.
