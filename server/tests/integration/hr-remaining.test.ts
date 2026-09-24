import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

const JOB_ID = "00000000-0000-4000-8000-000000000012";

async function login(app: Express) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: "admin", password: "admin123" });
  expect(res.status).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

describe("RH restante (compliance → onboarding)", () => {
  let app: Express;
  let token: string;
  let userId: string;

  beforeAll(async () => {
    app = createApp();
    const s = await login(app);
    token = s.token;
    userId = s.user.id;
  });

  it("requirement, worker cert, exam", async () => {
    const reqr = await request(app)
      .post("/api/job-role-requirements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        job_role_id: JOB_ID,
        kind: "CERTIFICATE",
        name: "CNH categoria D",
      });
    expect(reqr.status).toBe(201);

    const cert = await request(app)
      .post("/api/worker-certificates")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "CNH D",
        requirement_id: reqr.body.requirement.id,
      });
    expect(cert.status).toBe(201);

    const review = await request(app)
      .post(`/api/worker-certificates/${cert.body.certificate.id}/review`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "APPROVED" });
    expect(review.status).toBe(200);

    const exam = await request(app)
      .post("/api/occupational-exams")
      .set("Authorization", `Bearer ${token}`)
      .send({
        user_id: userId,
        kind: "PERIODIC",
        performed_at: "2026-09-01",
        fit: true,
      });
    expect(exam.status).toBe(201);
  });

  it("climate survey anonymous respond", async () => {
    const created = await request(app)
      .post("/api/climate-surveys")
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Clima Q3",
        is_anonymous: true,
        questions: [{ prompt: "Você se sente ouvido?" }],
      });
    expect(created.status).toBe(201);
    const id = created.body.survey.id;

    await request(app)
      .post(`/api/climate-surveys/${id}/open`)
      .set("Authorization", `Bearer ${token}`);

    const detail = await request(app)
      .get(`/api/climate-surveys/${id}`)
      .set("Authorization", `Bearer ${token}`);
    const qid = detail.body.survey.questions[0].id;

    const resp = await request(app)
      .post(`/api/climate-surveys/${id}/respond`)
      .set("Authorization", `Bearer ${token}`)
      .send({ answers: [{ question_id: qid, score: 4 }] });
    expect(resp.status).toBe(201);
    expect(resp.body.response.anonymous).toBe(true);
  });

  it("review cycle assign and submit", async () => {
    const cycle = await request(app)
      .post("/api/review-cycles")
      .set("Authorization", `Bearer ${token}`)
      .send({ title: "360 2026" });
    expect(cycle.status).toBe(201);
    const id = cycle.body.cycle.id;

    const asg = await request(app)
      .post(`/api/review-cycles/${id}/assignments`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reviewer_user_id: userId, reviewee_user_id: userId });
    expect(asg.status).toBe(201);

    const sub = await request(app)
      .post(`/api/review-assignments/${asg.body.assignment.id}/submit`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        answers: [{ competency: "Colaboração", score: 5 }],
      });
    expect(sub.status).toBe(200);
  });

  it("time entry, points, reward redeem, referral, onboarding", async () => {
    const time = await request(app)
      .post("/api/time-entries")
      .set("Authorization", `Bearer ${token}`)
      .send({
        day: "2026-09-24",
        in1: "08:00",
        out1: "12:00",
        in2: "13:00",
        out2: "17:00",
        balance_minutes: 0,
      });
    expect(time.status).toBe(201);

    await request(app)
      .post("/api/point-rules")
      .set("Authorization", `Bearer ${token}`)
      .send({ activity: "training_complete", points: 100 });

    const before = await request(app)
      .get("/api/points/balance")
      .set("Authorization", `Bearer ${token}`);
    expect(before.status).toBe(200);
    const balanceBefore = before.body.balance as number;

    const grant = await request(app)
      .post("/api/point-entries")
      .set("Authorization", `Bearer ${token}`)
      .send({
        user_id: userId,
        activity: "training_complete",
        points: 100,
      });
    expect(grant.status).toBe(201);

    const reward = await request(app)
      .post("/api/rewards")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: `Vale café ${Date.now()}`,
        cost: 50,
        stock: 10,
      });
    expect(reward.status).toBe(201);

    const redeem = await request(app)
      .post(`/api/rewards/${reward.body.reward.id}/redeem`)
      .set("Authorization", `Bearer ${token}`);
    expect(redeem.status).toBe(201);

    const balance = await request(app)
      .get("/api/points/balance")
      .set("Authorization", `Bearer ${token}`);
    expect(balance.status).toBe(200);
    expect(balance.body.balance).toBe(balanceBefore + 50);

    const ref = await request(app)
      .post("/api/referrals")
      .set("Authorization", `Bearer ${token}`)
      .send({
        candidate_name: "João Candidato",
        position: "Operador",
      });
    expect(ref.status).toBe(201);

    const step = await request(app)
      .post("/api/onboarding-steps")
      .set("Authorization", `Bearer ${token}`)
      .send({
        order: Date.now() % 100000,
        title: "Ler política de SST",
      });
    expect(step.status).toBe(201);

    const done = await request(app)
      .post(`/api/onboarding-steps/${step.body.step.id}/complete`)
      .set("Authorization", `Bearer ${token}`);
    expect(done.status).toBe(200);
  });
});
