import pako from 'pako'

/**
 * UCS 파일(tar.gz)에서 bigip.conf 내용을 추출합니다.
 * F5 UCS 파일은 gzip으로 압축된 tar 아카이브이며,
 * 내부에 config/bigip.conf 경로로 설정 파일이 포함되어 있습니다.
 */
export async function extractBigipConfFromUCS(file: File): Promise<string> {
  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  // Step 1: Gzip 압축 해제 (pako)
  let tarData: Uint8Array
  try {
    tarData = pako.ungzip(uint8Array)
  } catch {
    throw new Error(
      'UCS 파일의 압축을 해제할 수 없습니다. 유효한 UCS 파일인지 확인해 주세요.'
    )
  }

  // Step 2: tar 형식 파싱하여 bigip.conf 찾기
  const configContent = extractFileFromTar(tarData, 'config/bigip.conf')
  if (configContent !== null) {
    return configContent
  }

  // /config/bigip.conf 형식도 시도
  const configContent2 = extractFileFromTar(tarData, '/config/bigip.conf')
  if (configContent2 !== null) {
    return configContent2
  }

  // 일부 UCS 버전에서는 Config/bigip.conf 등 대소문자 다를 수 있음
  const configContent3 = extractFileFromTar(tarData, 'Config/bigip.conf')
  if (configContent3 !== null) {
    return configContent3
  }

  throw new Error(
    'UCS 파일 내에서 bigip.conf를 찾을 수 없습니다. 유효한 F5 UCS 파일인지 확인해 주세요.'
  )
}

/**
 * tar 아카이브 바이너리에서 특정 파일 경로의 내용을 추출합니다.
 *
 * tar 형식:
 * - 각 파일은 512바이트 헤더 + 파일 데이터로 구성
 * - 헤더는 512바이트, 데이터는 512바이트 단위로 패딩
 * - 문자열 필드는 null-terminated
 */
function extractFileFromTar(
  data: Uint8Array,
  targetPath: string
): string | null {
  let offset = 0

  while (offset + 512 <= data.length) {
    // 헤더 읽기 (512바이트)
    const header = data.subarray(offset, offset + 512)

    // tar 종료 마커 (모두 0으로 채워진 512바이트 블록)
    if (isAllZeros(header)) {
      break
    }

    // 파일 이름 (100바이트)
    const rawName = parseString(header.subarray(0, 100))
    if (!rawName) break

    // 파일 크기 (12바이트, 8진수 문자열)
    const sizeStr = parseString(header.subarray(124, 136))
    const fileSize = parseInt(sizeStr, 8)

    if (isNaN(fileSize)) break

    // 데이터 위치 (헤더 다음)
    offset += 512
    // 데이터를 512바이트로 패딩
    const paddedSize = Math.ceil(fileSize / 512) * 512

    // 정규화된 경로 비교 (선행 / 제거)
    const normalizedRaw = rawName.replace(/^\/+/, '')
    const normalizedTarget = targetPath.replace(/^\/+/, '')

    if (normalizedRaw === normalizedTarget && fileSize > 0) {
      // 파일 내용을 UTF-8 텍스트로 디코딩
      const fileData = data.subarray(offset, offset + fileSize)
      return new TextDecoder('utf-8', { fatal: false }).decode(fileData)
    }

    offset += paddedSize
  }

  return null
}

function parseString(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  const valid = end >= 0 ? bytes.subarray(0, end) : bytes
  return new TextDecoder('ascii').decode(valid)
}

function isAllZeros(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== 0) return false
  }
  return true
}
