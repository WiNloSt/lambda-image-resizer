const aws = require('aws-sdk')
const sharp = require('sharp')
const FileType = require('file-type')

const s3 = new aws.S3({ region: 'eu-west-1' })

exports.handler = (event, context, callback) => {
  /** @type {typeof mockRequest} */
  const request = event.Records[0].cf.request
  const parameters = new URLSearchParams(request.querystring)
  const normalizedParameters = normalizeParameters(parameters)
  console.log('normalizedParameters', normalizedParameters)
  if (normalizedParameters) {
    const bucket = request.origin.s3.domainName.split('.')[0]
    const key = request.uri.substring(1)
    const s3Params = {
      Bucket: bucket,
      Key: key,
    }
    s3.getObject(s3Params)
      .promise()
      .then(async (result) => {
        const fileType = await FileType.fromBuffer(result.Body)
        if (fileType) {
          const processedImageBuffer = await processImage(
            result.Body,
            normalizedParameters
          )

          return [processedImageBuffer, getHeadersFromFileType(fileType)]
        } else {
          return [result.Body, getHeadersFromS3Result(result)]
        }
      })
      .then(([buffer, headers]) => {
        const response = {
          status: 200,
          statusDescription: 'OK',
          body: buffer.toString('base64'),
          bodyEncoding: 'base64',
          headers,
        }
        callback(null, response)
      })
      .catch((error) => {
        console.error('error', error)
        const isS3Error = error.statusCode
        if (isS3Error) {
          const response = {
            status: error.statusCode,
          }
          callback(null, response)
        } else {
          const response = {
            status: 500,
            body: error,
          }
          callback(null, response)
        }
      })
  } else {
    callback(null, request)
  }
}

/**
 *
 * @param {FileType.FileTypeResult} fileType
 * @returns
 */
function getHeadersFromFileType(fileType) {
  return {
    'content-type': [{ key: 'Content-Type', value: fileType.mime }],
  }
}

/**
 *
 * @param {import('aws-sdk/lib/request').PromiseResult<aws.S3.GetObjectOutput, aws.AWSError>} s3Result
 */
function getHeadersFromS3Result(s3Result) {
  const s3ResultKeys = [
    'CacheControl',
    'ContentDisposition',
    'ContentEncoding',
    'ContentLanguage',
    'ContentType',
  ]
  const headers = getHeadersFromS3ResultKeys(s3ResultKeys, s3Result)

  if (s3Result.ETag) {
    headers['etag'] = [{ key: 'ETag', value: s3Result.ETag }]
  }
  if (s3Result.Expires) {
    headers['expires'] = [
      { key: 'Expires', value: s3Result.Expires.toUTCString() },
    ]
  }
  if (s3Result.LastModified) {
    headers['last-modified'] = [
      { key: 'Last-Modified', value: s3Result.LastModified.toUTCString() },
    ]
  }

  return headers
}

/**
 *
 * @param {string[]} s3ResultKeys
 * @param {import('aws-sdk/lib/request').PromiseResult<aws.S3.GetObjectOutput, aws.AWSError>} s3Result
 */
function getHeadersFromS3ResultKeys(s3ResultKeys, s3Result) {
  return s3ResultKeys.reduce((headers, s3ResultKey) => {
    if (s3Result[s3ResultKey]) {
      headers[toKebabCase(s3ResultKey)] = [
        { key: toHeaderKey(s3ResultKey), value: String(s3Result[s3ResultKey]) },
      ]
    }

    return headers
  }, {})
}

function toKebabCase(s3ResultKey) {
  return s3ResultKey.replace(/(\w)([A-Z])/g, '$1-$2').toLowerCase()
}

function toHeaderKey(s3ResultKey) {
  return s3ResultKey.replace(/(\w)([A-Z])/g, '$1-$2')
}

/**
 *
 * @param {URLSearchParams} parameters
 * @returns {object|null}
 */
function normalizeParameters(parameters) {
  const normalizedParameters = {}
  if (parameters.get('size')) {
    const size = parameters.get('size')
    normalizedParameters.size = size.split(/x/i).map((dimensionString) => {
      if (dimensionString) {
        return Number(dimensionString)
      } else {
        return undefined
      }
    })
  }

  if (!isObjectEmpty(normalizedParameters)) {
    return normalizedParameters
  } else {
    return null
  }
}

/**
 *
 * @param {object} object
 * @returns
 */
function isObjectEmpty(object) {
  return Object.keys(object).length === 0
}

const mockRequest = {
  clientIp: '49.49.219.90',
  headers: {
    'x-forwarded-for': [[Object]],
    'user-agent': [[Object]],
    via: [[Object]],
    'accept-encoding': [[Object]],
    host: [[Object]],
  },
  method: 'GET',
  origin: {
    s3: {
      authMethod: 'none',
      customHeaders: {},
      domainName: 'simplesat-upload-files-dev.s3.amazonaws.com',
      path: '',
    },
  },
  querystring: 'size=100x',
  uri: '/choice_images/2.png',
}

function processImage(imageBuffer, normalizedParameters) {
  let sharpImage = sharp(imageBuffer)

  if (normalizedParameters.size) {
    console.log('resizing image')
    const [width, height] = normalizedParameters.size
    sharpImage = sharpImage.resize({ width, height })
  }

  return sharpImage.toBuffer()
}
