export const params = [
  { key: 'server', label: '服务地址', type: 'url', hint: '部署自己的图片挑战服务，填入根地址', guide: 'https://github.com/LeUKi/hb-image-challenge#readme' },
  { key: 'challenge', label: '挑战描述', type: 'textarea', maxLength: 1000, default: '这张图片里有一只猫', hint: '描述可以回答“是或否”的图片特征，AI 给出匹配度' },
  { key: 'minScore', label: '最低匹配度（%）', type: 'integer', min: 0, max: 100, default: 70 },
  { key: 'maxScore', label: '最高匹配度（%）', type: 'integer', min: 0, max: 100, default: 100 },
  { key: 'maxAttempts', label: '每人最多上传次数', type: 'integer', min: 1, max: 10, default: 3, hint: '已开始处理的请求计入次数，最多 10 次；查看结果不占次数' },
  { key: 'saveImages', label: '保存玩家图片', type: 'switch', default: true, hint: '保存到你自己的私有 R2；关闭后仍保存评分与次数' },
  { key: 'reward', label: '挑战成功奖励', type: 'money', min: 1, default: 100 },
]
export const network = [{ param: 'server' }]
export const meta = {
  name: '图片挑战',
  description: '上传图片，由 AI 判断匹配度，落在指定区间即可领取奖励。每位作者部署自己的完整服务。',
  page: { param: 'server' },
}
export const hongbao = {
  pageAutoOpen: true,
  note: '[打开图片挑战，上传你的图片](#附带网页)\n上传图片等待评分，再提交结果。每人次数由作者设置，最多 10 次。分数表示 AI 的匹配判断，不是准确率。',
}
export function check(values) {
  const errors = []
  if (values.minScore > values.maxScore) errors.push({ key: 'maxScore', message: '最高匹配度不能低于最低匹配度' })
  try {
    if (new URL(values.server).pathname !== '/') errors.push({ key: 'server', message: '请填写服务根地址，不要附加路径' })
  } catch { errors.push({ key: 'server', message: '请填写有效的服务地址' }) }
  return errors
}

/** @param {import('./judge').Submission} submission */
export async function judge(submission) {
  const { input, params: rules, player } = submission
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input)) return { message: '请先在附带网页上传图片，再提交返回的结果编号' }
  const used = Array.isArray(player.state?.used) ? player.state.used : []
  if (used.includes(input)) return { message: '这个结果已经提交过了，不需要重复提交' }
  const address = new URL(`api/results/${encodeURIComponent(input)}`, rules.server)
  address.searchParams.set('user', String(submission.user.id))
  let result
  try {
    const response = await fetch(address)
    if (!response.ok) return { message: '评分服务暂时不可用，请稍后提交同一结果，不用重新上传' }
    result = await response.json()
  } catch { return { message: '暂时无法核验，请稍后提交同一结果，不用重新上传' } }
  if (!result || result.found !== true) return { message: '没有找到属于你的有效结果，请先完成图片评分' }
  if (result.id !== input || result.user !== String(submission.user.id) ||
      result.challenge !== rules.challenge || result.minScore !== rules.minScore || result.maxScore !== rules.maxScore ||
      result.maxAttempts !== rules.maxAttempts || result.saveImages !== rules.saveImages) return { message: '这个结果与当前挑战或玩家不匹配，不能领取' }
  if (typeof result.score !== 'number' || !Number.isFinite(result.score) || result.score < 0 || result.score > 100 ||
      !Number.isInteger(result.attempt) || result.attempt < 1 || result.attempt > rules.maxAttempts) return { message: '评分服务返回了无效结果，请联系红包作者' }
  const passed = result.score >= rules.minScore && result.score <= rules.maxScore
  const exhausted = result.attempt >= rules.maxAttempts
  const update = {
    state: { used: [...used, input] },
    view: { summary: passed ? '挑战通过' : '本次未通过', data: { v: 1, score: result.score, remaining: rules.maxAttempts - result.attempt, passed } },
  }
  return passed
    ? { add: rules.reward, settle: true, player: update, message: `${result.score.toFixed(1)}% 匹配度，挑战通过！` }
    : { player: update, ...(exhausted ? { settle: true } : {}), message: exhausted ? '本次未落在目标区间，机会已用完，挑战结束' : `${result.score.toFixed(1)}% 匹配度，未落在目标区间，可以换张图片再试` }
}
