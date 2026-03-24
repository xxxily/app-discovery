---
layout: home
title: "发现各平台优质 APP 及其开源替代品"

hero:
  name: "App-Discovery"
  text: 全平台优质应用探索与发现枢纽
  tagline: "// SYS.INIT: APP_FLUX_NODE // CONNECTING TO SYSTEM // STATUS: ONLINE"
  image:
    src: /assets/img/logo.png
    alt: App-Discovery
  actions:
    - theme: brand
      text: "> /START_CONNECTION"
      link: /home/

features:
- title: 🌍 全平台覆盖 (Cross-Platform)
  details: 深度搜罗 Windows, macOS, Android, iOS 及 Linux 平台的原生应用与跨端工具，满足你全场景的数字生活需求。
- title: ✨ 精选与平替 (Curated Alternatives)
  details: 拒绝臃肿，精选高质量、小众且强大的应用。同时为你提供商业软件的高质量开源替代方案，保护隐私更懂你的工作流。
- title: 🤖 智能更新 (Automated Evolution)
  details: 系统基于自动化探索算法，实时追踪 GitHub 及全网最新的应用趋势。每一个入库项目都经过多维度的评估与分类，确保资讯的鲜活性。

footer: SYSTEM_LICENSED // MIT | CORE_ONLINE // Copyright © 2026-present Blaze
---

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vitepress'
import stats from './data/stats.json'

const router = useRouter()
let clickHandler = null

onMounted(() => {
  if (typeof window !== 'undefined') {
    clickHandler = (e) => {
      const target = e.target.closest('.VPButton')
      if (target && target.textContent.includes('START_CONNECTION')) {
        if (window.innerWidth <= 768) {
          e.preventDefault()
          router.go('/home/categories.html')
        }
      }
    }
    document.addEventListener('click', clickHandler)
  }
})

onUnmounted(() => {
  if (typeof window !== 'undefined' && clickHandler) {
    document.removeEventListener('click', clickHandler)
  }
})
</script>

<div class="global-stats-wrapper">
  <div class="global-stats-container">
    <div class="stats-badge">
      <div class="pulse-ring"></div>
      <div class="pulse-dot"></div>
      <div class="stats-text">
        侦测到当前已收录 <strong class="stats-num">{{ stats.totalProjects }}</strong> 个优质项目
      </div>
    </div>
  </div>
</div>

<style scoped>
.global-stats-container {
  display: flex;
  justify-content: center;
  align-items: center;
  margin-top: 36px;
  position: relative;
  z-index: 2;
}
.stats-badge {
  display: flex;
  align-items: center;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  padding: 8px 20px;
  border-radius: 30px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
  position: relative;
  overflow: hidden;
}
.stats-badge::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(90deg, rgba(var(--vp-c-brand-1-rgb, 0, 242, 254), 0.05), transparent);
  pointer-events: none;
}
.pulse-ring {
  position: absolute;
  left: 17px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  opacity: 0.4;
  animation: pulse-ring 2s cubic-bezier(0.215, 0.61, 0.355, 1) infinite;
}
.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--vp-c-brand-1);
  margin-right: 12px;
  box-shadow: 0 0 10px var(--vp-c-brand-1);
  position: relative;
  z-index: 1;
}
.stats-text {
  position: relative;
  z-index: 1;
}
.stats-num {
  color: var(--vp-c-brand-1);
  font-size: 1.1rem;
  margin: 0 4px;
  text-shadow: 0 0 8px rgba(var(--vp-c-brand-1-rgb, 0, 242, 254), 0.4);
}
@keyframes pulse-ring {
  0% { transform: scale(0.6); opacity: 0.8; }
  100% { transform: scale(2.5); opacity: 0; }
}
</style>
