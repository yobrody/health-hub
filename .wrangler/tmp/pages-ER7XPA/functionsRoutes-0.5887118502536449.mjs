import { onRequestOptions as __api_ai_analyze_food_js_onRequestOptions } from "D:\\Development\\health-hub\\pwa\\functions\\api\\ai\\analyze-food.js"
import { onRequestPost as __api_ai_analyze_food_js_onRequestPost } from "D:\\Development\\health-hub\\pwa\\functions\\api\\ai\\analyze-food.js"
import { onRequestOptions as __api_ai_meals_js_onRequestOptions } from "D:\\Development\\health-hub\\pwa\\functions\\api\\ai\\meals.js"
import { onRequestPost as __api_ai_meals_js_onRequestPost } from "D:\\Development\\health-hub\\pwa\\functions\\api\\ai\\meals.js"
import { onRequestOptions as __api_fridge_scan_js_onRequestOptions } from "D:\\Development\\health-hub\\pwa\\functions\\api\\fridge\\scan.js"
import { onRequestPost as __api_fridge_scan_js_onRequestPost } from "D:\\Development\\health-hub\\pwa\\functions\\api\\fridge\\scan.js"
import { onRequestGet as __api_stats_week_js_onRequestGet } from "D:\\Development\\health-hub\\pwa\\functions\\api\\stats\\week.js"
import { onRequestOptions as __api_stats_week_js_onRequestOptions } from "D:\\Development\\health-hub\\pwa\\functions\\api\\stats\\week.js"
import { onRequestOptions as __api___path___js_onRequestOptions } from "D:\\Development\\health-hub\\pwa\\functions\\api\\[[path]].js"
import { onRequest as __api___path___js_onRequest } from "D:\\Development\\health-hub\\pwa\\functions\\api\\[[path]].js"

export const routes = [
    {
      routePath: "/api/ai/analyze-food",
      mountPath: "/api/ai",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_ai_analyze_food_js_onRequestOptions],
    },
  {
      routePath: "/api/ai/analyze-food",
      mountPath: "/api/ai",
      method: "POST",
      middlewares: [],
      modules: [__api_ai_analyze_food_js_onRequestPost],
    },
  {
      routePath: "/api/ai/meals",
      mountPath: "/api/ai",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_ai_meals_js_onRequestOptions],
    },
  {
      routePath: "/api/ai/meals",
      mountPath: "/api/ai",
      method: "POST",
      middlewares: [],
      modules: [__api_ai_meals_js_onRequestPost],
    },
  {
      routePath: "/api/fridge/scan",
      mountPath: "/api/fridge",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_fridge_scan_js_onRequestOptions],
    },
  {
      routePath: "/api/fridge/scan",
      mountPath: "/api/fridge",
      method: "POST",
      middlewares: [],
      modules: [__api_fridge_scan_js_onRequestPost],
    },
  {
      routePath: "/api/stats/week",
      mountPath: "/api/stats",
      method: "GET",
      middlewares: [],
      modules: [__api_stats_week_js_onRequestGet],
    },
  {
      routePath: "/api/stats/week",
      mountPath: "/api/stats",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api_stats_week_js_onRequestOptions],
    },
  {
      routePath: "/api/:path*",
      mountPath: "/api",
      method: "OPTIONS",
      middlewares: [],
      modules: [__api___path___js_onRequestOptions],
    },
  {
      routePath: "/api/:path*",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api___path___js_onRequest],
    },
  ]