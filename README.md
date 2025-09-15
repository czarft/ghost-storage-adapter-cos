# Ghost storage adapter COS

A Tencent Cloud Object Storage (COS) adapter for Ghost 1.x+

This adapter allows Ghost CMS to store uploaded files in Tencent COS buckets instead of local storage, with support for private bucket access through Ghost's `/images/` route.

## Installation

```shell
npm install ghost-storage-adapter-cos
mkdir -p ./content/adapters/storage
cp -r ./node_modules/ghost-storage-adapter-cos ./content/adapters/storage/cos
```

## Configuration

```json
"storage": {
  "active": "cos",
  "cos": {
    "secretId": "YOUR_SECRET_ID",
    "secretKey": "YOUR_SECRET_KEY",
    "region": "YOUR_COS_REGION",
    "bucket": "YOUR_BUCKET_NAME",
    "assetHost": "YOUR_OPTIONAL_CDN_URL (See note 1 below)",
    "pathPrefix": "YOUR_OPTIONAL_BUCKET_SUBDIRECTORY",
    "domain": "YOUR_OPTIONAL_CUSTOM_DOMAIN",
    "protocol": "https:"
  }
}
```

**Note 1**: Be sure to include "//" or the appropriate protocol within your assetHost string/variable to ensure that your site's domain is not prepended to the CDN URL.

**Note 2**: If you're using a private bucket, Ghost will serve images through the `/images/` route, allowing public access to private COS objects.

### Via environment variables

```
GHOST_STORAGE_ADAPTER_COS_SECRET_ID
GHOST_STORAGE_ADAPTER_COS_SECRET_KEY
GHOST_STORAGE_ADAPTER_COS_REGION
GHOST_STORAGE_ADAPTER_COS_BUCKET
GHOST_STORAGE_ADAPTER_COS_ASSET_HOST  // optional
GHOST_STORAGE_ADAPTER_COS_PATH_PREFIX // optional
GHOST_STORAGE_ADAPTER_COS_DOMAIN // optional
GHOST_STORAGE_ADAPTER_COS_PROTOCOL // optional
```

## Tencent COS Configuration
You'll need to configure a COS bucket and obtain the necessary credentials from the Tencent Cloud console.

### COS Bucket Setup

1. **Create a COS Bucket**
   - Log in to the [Tencent Cloud Console](https://console.cloud.tencent.com/)
   - Go to the COS service
   - Create a new bucket in your preferred region
   - Choose appropriate access permissions (public read for public websites, private for private buckets)

2. **Get Credentials**
   - Go to [CAM Console](https://console.cloud.tencent.com/cam/capi)
   - Create or use existing API keys to get your `SecretId` and `SecretKey`
   - These will be used as `secretId` and `secretKey` in your configuration

3. **Bucket Configuration**
   - For **private buckets**: Ghost will serve images through `/images/` route, allowing public access to private COS objects
   - For **public buckets**: Images can be accessed directly via COS URLs
   - Configure CORS if you need cross-origin access

### CDN Setup (Optional)

If you want to use Tencent Cloud CDN:

1. **Enable CDN**
   - Go to CDN service in Tencent Cloud Console
   - Add your bucket domain as origin server
   - Configure cache rules and HTTPS

2. **Custom Domain**
   - If using a custom domain, configure it in COS bucket settings
   - Update DNS to point to your CDN domain
   - Use the CDN domain as `assetHost` in your configuration

## License

[ISC](./LICENSE.md)
