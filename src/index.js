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
      protocol,
      privateStorage,
      debug
    } = config

    // Debug mode
    this.debug = process.env.GHOST_STORAGE_ADAPTER_COS_DEBUG === 'true' || debug || false

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
    this.privateStorage = process.env.GHOST_STORAGE_ADAPTER_COS_PRIVATE_STORAGE === 'true' || privateStorage || false

    // Asset host for CDN or custom domain
    // For private storage, don't set host so Ghost uses serve() method
    if (this.privateStorage) {
      const customHost = process.env.GHOST_STORAGE_ADAPTER_COS_ASSET_HOST || assetHost
      this.host = customHost && customHost.trim() !== '' ? customHost : undefined
    } else {
      this.host = process.env.GHOST_STORAGE_ADAPTER_COS_ASSET_HOST || assetHost ||
        (this.domain ? `${this.protocol}//${this.domain}` :
         `${this.protocol}//${this.bucket}.cos.${this.region}.myqcloud.com`)
    }

    this.log('COS Adapter initialized with config:', {
      bucket: this.bucket,
      region: this.region,
      pathPrefix: this.pathPrefix,
      privateStorage: this.privateStorage,
      host: this.host,
      debug: this.debug
    })
  }

  log(message, data = null) {
    if (this.debug) {
      const timestamp = new Date().toISOString()
      console.log(`[${timestamp}] [COS Debug] ${message}`)
      if (data) {
        console.log(`[${timestamp}] [COS Debug] Data:`, JSON.stringify(data, null, 2))
      }
    }
  }

  delete (fileName, targetDir) {
    const directory = targetDir || this.getTargetDir(this.pathPrefix)
    const key = stripLeadingSlash(join(directory, fileName))

    this.log('Delete called', { fileName, targetDir, directory, key })

    return new Promise((resolve, reject) => {
      this.cos().deleteObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: key
      }, (err, data) => {
        this.log('Delete result', { key, error: err && err.message, success: !err })
        if (err) {
          resolve(false)
        } else {
          resolve(true)
        }
      })
    })
  }

  exists (fileName, targetDir) {
    const key = stripLeadingSlash(join(targetDir, fileName))
    this.log('Exists called', { fileName, targetDir, key })

    return new Promise((resolve, reject) => {
      this.cos().headObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: key
      }, (err, data) => {
        this.log('Exists result', { key, error: err && err.message, exists: !err })
        if (err) {
          resolve(false)
        } else {
          resolve(true)
        }
      })
    })
  }

  cos () {
    this.log('Creating COS instance', {
      secretId: this.secretId ? '[SET]' : '[NOT SET]',
      secretKey: this.secretKey ? '[SET]' : '[NOT SET]'
    })
    return new COS({
      SecretId: this.secretId,
      SecretKey: this.secretKey
    })
  }

  save (image, targetDir) {
    const directory = targetDir || this.getTargetDir(this.pathPrefix)

    this.log('Save called', {
      imagePath: image.path,
      imageType: image.type,
      targetDir,
      directory,
      privateStorage: this.privateStorage,
      host: this.host
    })

    return new Promise((resolve, reject) => {
      Promise.all([
        this.getUniqueFileName(image, directory),
        readFileAsync(image.path)
      ]).then(([ fileName, file ]) => {
        // Normalize filename to lowercase to match Ghost's URL normalization
        const normalizedFileName = fileName.toLowerCase()

        this.log('About to upload to COS', {
          originalFileName: fileName,
          normalizedFileName,
          bucket: this.bucket,
          region: this.region,
          key: stripLeadingSlash(normalizedFileName)
        })

        this.cos().putObject({
          Bucket: this.bucket,
          Region: this.region,
          Key: stripLeadingSlash(normalizedFileName),
          Body: file,
          ContentType: image.type,
          CacheControl: `max-age=${30 * 24 * 60 * 60}`
        }, (err, data) => {
          if (err) {
            this.log('Save failed', { error: err.message, fileName })
            reject(err)
          } else {
            let finalUrl
            // For private storage with undefined host, return relative URL so Ghost uses serve() method
            if (this.privateStorage && this.host === undefined) {
              finalUrl = `/${this.pathPrefix ? this.pathPrefix + '/' : ''}${normalizedFileName}`
            } else {
              finalUrl = `${this.host}/${normalizedFileName}`
            }

            this.log('Save successful', {
              fileName: normalizedFileName,
              finalUrl,
              isPrivateWithoutHost: this.privateStorage && this.host === undefined,
              hostValue: this.host,
              hostType: typeof this.host
            })
            resolve(finalUrl)
          }
        })
      })
      .catch(err => {
        this.log('Save error during file operations', { error: err.message })
        reject(err)
      })
    })
  }

  serve () {
    this.log('serve() method called - returning middleware function')

    return (req, res, next) => {
      const key = stripLeadingSlash(stripEndingSlash(this.pathPrefix) + req.path)

      this.log('serve() middleware executing', {
        requestPath: req.path,
        pathPrefix: this.pathPrefix,
        finalKey: key,
        method: req.method,
        headers: req.headers
      })

      // Try normalized (lowercase) key first
      this.cos().getObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: key
      }, (err, data) => {
        if (err) {
          this.log('serve() first attempt failed, trying case variations', {
            key,
            error: err.message
          })
          // If not found, try case-insensitive search for existing files
          this.tryKeyVariations([
            key,
            // Try to reconstruct original mixed case from URL path
            this.reconstructOriginalCase(key)
          ], 0, (findErr, foundKey) => {
            if (findErr || !foundKey) {
              this.log('serve() all variations failed', {
                originalError: err.message,
                findError: findErr && findErr.message
              })
              res.status(404)
              next(err)
            } else {
              this.log('serve() found file with variation', { foundKey })
              // Get the file with correct key
              this.cos().getObject({
                Bucket: this.bucket,
                Region: this.region,
                Key: foundKey
              }, (retryErr, retryData) => {
                if (retryErr) {
                  this.log('serve() retry failed', { error: retryErr.message })
                  res.status(404)
                  next(retryErr)
                } else {
                  this.log('serve() successfully serving file with variation')
                  this.sendFileResponse(res, retryData)
                }
              })
            }
          })
        } else {
          this.log('serve() file found on first attempt, serving')
          this.sendFileResponse(res, data)
        }
      })
    }
  }

  reconstructOriginalCase(lowercaseKey) {
    // For the specific file pattern, try to reconstruct original case
    // Example: true-smart-livingtech_2000x1125.jpg → True-Smart-LivingTech_2000x1125.jpg
    const reconstructed = lowercaseKey
      .split('/')
      .map(part => {
        if (part.includes('.jpg') || part.includes('.png') || part.includes('.gif')) {
          // Handle filename with extensions
          return part.replace(/\b\w/g, l => l.toUpperCase())
            .replace(/[-_]\w/g, l => l.toUpperCase())
        }
        return part
      })
      .join('/')

    this.log('reconstructOriginalCase', {
      input: lowercaseKey,
      output: reconstructed
    })

    return reconstructed
  }

  sendFileResponse(res, data) {
    this.log('sendFileResponse called', {
      hasHeaders: !!data.headers,
      hasBody: !!data.Body,
      headers: data.headers
    })

    // Set appropriate headers
    if (data.headers) {
      Object.keys(data.headers).forEach(header => {
        res.set(header, data.headers[header])
      })
    }

    if (data.Body) {
      this.log('Sending file response with body')
      res.send(data.Body)
    } else {
      this.log('No body found, returning 404')
      res.status(404)
      next(new Error('File not found'))
    }
  }

  findFileWithCaseInsensitive(targetKey, callback) {
    // Simplified approach: try common case variations
    const variations = [
      targetKey,
      targetKey.toLowerCase(),
      targetKey.toUpperCase(),
      // Try first letter uppercase
      targetKey.charAt(0).toUpperCase() + targetKey.slice(1).toLowerCase()
    ]

    this.log('findFileWithCaseInsensitive called', {
      targetKey,
      variations
    })

    this.tryKeyVariations(variations, 0, callback)
  }

  tryKeyVariations(variations, index, callback) {
    if (index >= variations.length) {
      this.log('tryKeyVariations exhausted all variations')
      callback(new Error('File not found'), null)
      return
    }

    const key = variations[index]

    this.log('tryKeyVariations attempting', {
      variation: index + 1,
      total: variations.length,
      key
    })

    this.cos().headObject({
      Bucket: this.bucket,
      Region: this.region,
      Key: key
    }, (err, data) => {
      if (err) {
        this.log('tryKeyVariations failed for key', {
          key,
          error: err.message
        })
        // Try next variation
        this.tryKeyVariations(variations, index + 1, callback)
      } else {
        // Found it!
        this.log('tryKeyVariations found matching key', { key })
        callback(null, key)
      }
    })
  }

  read (options) {
    options = options || {}

    this.log('Read called', { options })

    return new Promise((resolve, reject) => {
      // remove trailing slashes
      let path = (options.path || '').replace(/\/$|\\$/, '')

      this.log('Read processing path', {
        originalPath: options.path,
        cleanedPath: path,
        host: this.host
      })

      // check if path is stored in COS handled by us
      if (!path.startsWith(this.host)) {
        this.log('Read rejected - path not handled by this adapter', {
          path,
          host: this.host
        })
        reject(new Error(`${path} is not stored in COS`))
        return
      }
      path = path.substring(this.host.length)

      const key = stripLeadingSlash(path)

      this.log('Read attempting to get object', {
        finalPath: path,
        key,
        bucket: this.bucket,
        region: this.region
      })

      this.cos().getObject({
        Bucket: this.bucket,
        Region: this.region,
        Key: key
      }, (err, data) => {
        if (err) {
          this.log('Read failed', { error: err.message, key })
          reject(err)
        } else {
          this.log('Read successful', { key, hasBody: !!data.Body })
          resolve(data.Body)
        }
      })
    })
  }
}

export default Store
