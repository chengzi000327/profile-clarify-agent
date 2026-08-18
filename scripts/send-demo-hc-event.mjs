import { createHmac } from 'node:crypto'

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

const endpoint = process.env.HC_EVENT_URL
const secret = process.env.HC_EVENT_SECRET

if (!endpoint || !secret) {
  throw new Error('HC_EVENT_URL and HC_EVENT_SECRET are required')
}

const occurredAt = new Date().toISOString()
const suffix = occurredAt.replaceAll(/[-:.TZ]/g, '')
const requestId = `HC-DEMO-${suffix}`

const event = {
  event_id: `evt-${requestId}-approved`,
  event_type: 'HC_APPROVED',
  occurred_at: occurredAt,
  tenant_id: 'tenant-demo',
  hc: {
    request_id: requestId,
    title: '企业产品经理',
    department: '企业服务产品部',
    hiring_manager_user_id: 'manager-demo',
    assigned_hr_user_id: 'hr-demo',
    context: {
      request_id: requestId,
      status: 'APPROVED',
      approved_at: occurredAt,
      business_change: '企业服务业务从项目交付转向标准产品经营。',
      organization_gap: '缺少统一负责产品边界和规模化验证的岗位。',
      approved_reason: '新增企业产品经理，沉淀跨项目可复用能力。',
      initial_responsibilities: ['定义产品边界', '规划产品路线图', '组织客户验证'],
      recruiting_budget: '年度新增编制预算内',
      recruiting_constraints: ['8 周内到岗'],
      hiring_manager_user_id: 'manager-demo',
      assigned_hr_user_id: 'hr-demo',
      job_basics: {
        recruitment_type: 'NEW_HEADCOUNT',
        headcount: 1,
        level: '3-2 至 4-1',
        reporting_line: '产品负责人',
        locations: ['北京', '上海'],
        employment_type: '全职',
        salary_range: '35K-50K·15薪',
        target_onboard: '8 周内',
      },
    },
  },
}

const signature = createHmac('sha256', secret)
  .update(`${occurredAt}.${canonicalJson(event)}`)
  .digest('hex')

const response = await fetch(endpoint, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-hc-event-timestamp': occurredAt,
    'x-hc-event-signature': signature,
  },
  body: JSON.stringify(event),
})

const body = await response.text()
if (!response.ok) {
  throw new Error(`HC event failed (${response.status}): ${body.slice(0, 500)}`)
}

console.log(body)
