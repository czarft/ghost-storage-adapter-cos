import COS from 'cos-nodejs-sdk-v5'
import BaseStore from 'ghost-storage-base'
import { join } from 'path'
import { readFile } from 'fs'

const readFileAsync = fp => new Promise((resolve, reject) => readFile(fp, (err, data) => err ? reject(err) : resolve(data)))
const stripLeadingSlash = s => s.indexOf('/') === 0 ? s.substring(1) : s
const stripEndingSlash = s => s.indexOf('/') === (s.length - 1) ? s.substring(0, s.length - 1) : s

class Store extends BaseStore {
  constructor (config = {}) {
    super(config)

    const {
      secretId,
      secretKey,
      assetHost,
      bucket,
      pathPrefix,
      region,
      appId,
      domain,
      protocol
    } = config

    // COS credentials - required
    this.secretId = process.env.GHOST_STORAGE_ADAPTER_COS_SECRET_ID || secretId
    this.secretKey = process.env.GHOST_STORAGE_ADAPTER_COS_SECRET_KEY || secretKey

    // COS bucket configuration - required
    this.bucket = process.env.GHOST_STORAGE_ADAPTER_COS_BUCKET || bucket
    this.region = process.env.GHOST_STORAGE_ADAPTER_COS_REGION || region

    // Optional configurations
    this.pathPrefix = stripLeadingSlash(process.env.GHOST_STORAGE_ADAPTER_COS_PATH_PREFIX || pathPrefix || '')
    this.domain = process.env.GHOST_STORAGE_ADAPTER_COS_DOMAIN || domain || ''
    this.protocol = process.env.GHOST_STORAGE_ADAPTER_COS_PROTOCOL || protocol || 'https:'

    // Asset host for CDN or custom domain
    this.host = process.env.GHOST_STORAGE_ADAPTER_COS_ASSET_HOST || assetHost ||
      (this.domain ? `${this.protocol}//${this.domain}` :
       `${this.protocol}//${this.bucket}.cos.${this.region}.myqcloud.com`)
  }

  delete (fileName, targetDir) {
    const directory = targetDir || this.getTargetDir(this.pathPrefix)

    return new Promise((resolve, reject) => {
      this.cos().deleteObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: stripLeadingSlash(join(directory, fileName))
      }, (err, data) => {
        if (err) {
          resolve(false)
        } else {
          resolve(true)
        }
      })
    })
  }

  exists (fileName, targetDir) {
    return new Promise((resolve, reject) => {
      this.cos().headObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: stripLeadingSlash(join(targetDir, fileName))
      }, (err, data) => {
        if (err) {
          resolve(false)
        } else {
          resolve(true)
        }
      })
    })
  }

  cos () {
    return new COS({
      SecretId: this.secretId,
      SecretKey: this.secretKey
    })
  }

  save (image, targetDir) {
    const directory = targetDir || this.getTargetDir(this.pathPrefix)

    return new Promise((resolve, reject) => {
      Promise.all([
        this.getUniqueFileName(image, directory),
        readFileAsync(image.path)
      ]).then(([ fileName, file ]) => {
        this.cos().putObject({
          Bucket: this.bucket,
          Region: this.region,
          Key: stripLeadingSlash(fileName),
          Body: file,
          ContentType: image.type,
          CacheControl: `max-age=${30 * 24 * 60 * 60}`
        }, (err, data) => {
          if (err) {
            reject(err)
          } else {
            resolve(`${this.host}/${fileName}`)
          }
        })
      })
      .catch(err => reject(err))
    })
  }

  serve () {
    return (req, res, next) => {
      const key = stripLeadingSlash(stripEndingSlash(this.pathPrefix) + req.path)

      this.cos().getObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: key
      }, (err, data) => {
        if (err) {
          res.status(404)
          next(err)
        } else {
          // Set appropriate headers
          if (data.headers) {
            Object.keys(data.headers).forEach(header => {
              res.set(header, data.headers[header])
            })
          }

          if (data.Body) {
            res.send(data.Body)
          } else {
            res.status(404)
            next(new Error('File not found'))
          }
        }
      })
    }
  }

  read (options) {
    options = options || {}

    return new Promise((resolve, reject) => {
      // remove trailing slashes
      let path = (options.path || '').replace(/\/$|\\$/, '')

      // check if path is stored in COS handled by us
      if (!path.startsWith(this.host)) {
        reject(new Error(`${path} is not stored in COS`))
      }
      path = path.substring(this.host.length)

      this.cos().getObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: stripLeadingSlash(path)
      }, (err, data) => {
        if (err) {
          reject(err)
        } else {
          resolve(data.Body)
        }
      })
    })
  }
}

export default Store
