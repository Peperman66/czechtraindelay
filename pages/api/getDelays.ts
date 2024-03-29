// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import { Agent } from 'https';
import type { NextApiRequest, NextApiResponse } from 'next'
import fetch from 'node-fetch';
import { CompanyInfo, DelayInfo, TimeInfo, TrainInfo } from '../../types/DelayInfo'
import { SZResponse } from '../../types/SZResponse'

const regionalTrainTypes = ["Os", "Sp", "LET", "TL"]

async function GetSZData(): Promise<SZResponse> {
  const res = await fetch("https://mapy.spravazeleznic.cz/serverside/request2.php?module=Layers\\OsVlaky&action=load", {
    headers: {
      Host: "mapy.spravazeleznic.cz",
      Origin: "https://mapy.spravazeleznic.cz",
    },
    referrer: "https://mapy.spravazeleznic.cz",
    //Somehow this website is failing on returning correct certificate,
    //but we aren't transfering any confidential data
    agent: new Agent({rejectUnauthorized: false})
  });
  return await (res.json() as any as Promise<SZResponse>);
}

function ParseDate(dateString: string): Date {
  //Example input: "11.08.2022 23:20:12"
  const dayPart = dateString.split(' ')[0].split('.')
  const day = parseInt(dayPart[0])
  const month = parseInt(dayPart[1]) - 1 // - 1 because months are 0-indexed
  const year = parseInt(dayPart[2])

  const timePart = dateString.split(' ')[1].split(':')
  const hour = parseInt(timePart[0])
  const minute = parseInt(timePart[1])
  const second = parseInt(timePart[2])

  return new Date(Date.UTC(year, month, day, hour, minute, second))
}

function CalculateDelays(delayData: SZResponse): DelayInfo {
  const result: DelayInfo = {
    companies: [],
    timeFetched: delayData.md /*ParseDate(delayData.md).toISOString()*/
  }
  const companyTrains: Record<string, {trains: Array<TrainInfo>, timeInfo: TimeInfo}> = {}

  delayData.result.forEach(train => {
    if (!companyTrains[train.properties.d]) {
      companyTrains[train.properties.d] = {trains: [], timeInfo: {under0: 0, to5: 0, over5: 0, over15: 0, over30: 0, over60: 0}}
    }
    const companyTrainData = companyTrains[train.properties.d]
    companyTrainData.trains.push({
      type: train.properties.tt, delay: train.properties.de
    })
    if (train.properties.de > 60) {
      companyTrainData.timeInfo.over60++;
    } else if (train.properties.de > 30) {
      companyTrainData.timeInfo.over30++;
    } else if (train.properties.de > 15) {
      companyTrainData.timeInfo.over15++;
    } else if (train.properties.de > 5) {
      companyTrainData.timeInfo.over5++;
    } else if (train.properties.de >= 0) {
      companyTrainData.timeInfo.to5++;
    } else {
      companyTrainData.timeInfo.under0++;
    }
    
  })

  Object.keys(companyTrains).forEach(companyName => {
    let totalDelay = 0
    let totalRegionalDelay = 0
    let totalRegionalTrains = 0
    let totalLongDistanceDelay = 0
    let totalLongDistanceTrains = 0 
    companyTrains[companyName].trains.forEach(train => {
      if (regionalTrainTypes.includes(train.type)) {
        totalRegionalDelay += train.delay
        totalRegionalTrains++
      } else {
        totalLongDistanceDelay += train.delay
        totalLongDistanceTrains++
      }
      totalDelay += train.delay
    })
    const companyInfo: CompanyInfo = {
      company: companyName,
      avgDelay: {
        avgDelay: totalDelay / companyTrains[companyName].trains.length,
        avgRegionalDelay: totalRegionalDelay / totalRegionalTrains,
        avgLongDistanceDelay: totalLongDistanceDelay / totalLongDistanceTrains
      },
      delayInfo: {
        ...companyTrains[companyName].timeInfo
      },
      trainCounts: {
        total: companyTrains[companyName].trains.length,
        totalRegional: totalRegionalTrains,
        totalLongDistance: totalLongDistanceTrains
      }
    }
    result.companies.push(companyInfo)
  })
  result.companies.sort((a, b) => b.trainCounts.total - a.trainCounts.total)
  return result
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<DelayInfo>
) {
  const szResponse = await GetSZData()
  const delayInfo = CalculateDelays(szResponse)
  res.status(200).setHeader("Cache-Control", "max-age=0, s-maxage=60").json(delayInfo)
}