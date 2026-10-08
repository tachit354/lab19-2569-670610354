import { Router, type Request, type Response } from "express";
import { zEnrollmentBody, zEnrollmentPutBody } from "../libs/zodValidators.ts";

import type { CustomRequest, Enrollment } from "../libs/types.ts";

// import authentication middleware
import { authenticateToken } from "../middlewares/authenMiddleware.ts";
import { checkRoles } from "../middlewares/checkRolesDBMiddleware.ts";

// import database
import { PrismaClient } from "../../generated/prisma/client.ts";
import { success } from "zod";
const prisma = new PrismaClient();

const router = Router();

// GET /api/v3/enrollments
// ADMIN: get all enrollments, STUDENT: get only his own enrollments
router.get(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      const user = req.user;
      const enrollments = await prisma.enrollment.findMany({
        where:
          user?.role === "STUDENT" ? { studentId: user.studentId ?? "" } : {},
        orderBy: { createdAt: "asc" },
      });

      return res.json({
        success: true,
        data: enrollments,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

// POST /api/v3/enrollments, body = {studentId, courseId}
// ADMIN: enroll any student, STUDENT: enroll only himself
router.post(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      // validate req.body
      const result = zEnrollmentBody.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: result.error.issues[0]?.message,
        });
      }
      const { studentId, courseId } = result.data;

      // STUDENT can enroll only himself
      const user = req.user;
      if (user?.role === "STUDENT" && studentId !== user.studentId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden access",
        });
      }

      // check if student and course exist
      const student = await prisma.student.findUnique({
        where: { studentId },
      });
      if (!student) {
        return res.status(404).json({
          success: false,
          message: `Student ${studentId} does not exists`,
        });
      }
      const course = await prisma.course.findUnique({ where: { courseId } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: `Course ${courseId} does not exists`,
        });
      }

      // check if the student already enrolled in this course
      const enrolled = await prisma.enrollment.findFirst({
        where: { studentId, courseId },
      });
      if (enrolled) {
        return res.status(409).json({
          success: false,
          message: `Student ${studentId} has already enrolled in ${courseId}`,
        });
      }

      const created = await prisma.enrollment.create({
        data: { studentId, courseId },
      });

      return res.status(201).json({
        success: true,
        data: created,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

// TODO การบ้าน 2.1: PUT /api/v3/enrollments, body = {studentId, courseId, newCourseId}
//   เปลี่ยนวิชาที่ลงทะเบียนไว้ (courseId → newCourseId)
//   - ADMIN แก้ได้ทุกคน / STUDENT แก้ได้แค่ของตัวเอง (403)
//   - validate body (400), ยังไม่ได้ลงวิชาเดิม (404), วิชาใหม่ = วิชาเดิม (400),
//     วิชาใหม่ไม่มีจริง (404), ลงวิชาใหม่ไว้แล้ว (409)
router.put("/",authenticateToken, checkRoles, async (req:CustomRequest, res:Response) => {
  const user = req.user;
  const body = req.body as {
    studentId: string;
    courseId: string;
    newCourseId: string;
  };

  const result = zEnrollmentPutBody.safeParse(body);
  if (!result.success) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: result.error.issues[0]?.message,
        });
  }

  const studentId = result.data.studentId;
  if(user?.role === "STUDENT"){
    if(user.studentId !== studentId){
      return res.status(403).json({
          success: false,
          massege: "Forbidden access",
      })
    }
  }else if(user?.role != "ADMIN"){
      return res.status(403).json({
          success: false,
          massege: "Forbidden access",
      })
  }

  const courseId = result.data.courseId;
  const student = await prisma.enrollment.findMany({
    where: {studentId: studentId}
  });

  console.log(student);
  if(student.length === 0){
    return res.status(404).json({
      success: false,
      messege: `${studentId} hasn't registered for ${courseId}`,
    })
  }

  const coures = student.find((c) => c.courseId === courseId);
  if(!coures){
    return res.status(404).json({
      success: false,
      messege: `${courseId} hasn't been registered `,
    })
  }

  const newCourseId = result.data.newCourseId;
  const newCourse = await prisma.course.findUnique({
    where: {courseId: newCourseId}
  })
  if(!newCourse){
    return res.status(404).json({
      success: false,
      messege: `${newCourseId} not Founded`,
    })
  }

  if(courseId === newCourseId){
    return res.status(400).json({
      success: false,
      messege: `${newCourseId} already exists`,
    })
  }

  const conflict_newCourse = student.find((n) => n.courseId === newCourseId);
  if(conflict_newCourse){
    return res.status(409).json({
      success: false,
      messege: `${newCourseId} already conflict`,
    })
  }
  
  const updateEnrollment = await prisma.enrollment.update({
    where:{
      id: coures.id
    },
    data: {
      courseId: newCourseId,
    }
  })

  return res.status(200).json({
    success:true,
    messege: `update data ${newCourseId} success`,
    data: updateEnrollment,
  })
})

// TODO การบ้าน 2.2: DELETE /api/v3/enrollments, body = {studentId, courseId}
//   ยกเลิกการลงทะเบียน (drop)
//   - ADMIN ลบได้ทุกคน / STUDENT ลบได้แค่ของตัวเอง (403)
//   - validate body (400), ไม่พบการลงทะเบียน (404)
router.delete("/", authenticateToken, checkRoles, async (req:CustomRequest, res:Response) => {
  try{
    const user = req.user;
    const body = req.body as Enrollment;

    const result = zEnrollmentBody.safeParse(body);
    if(!result.success){
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: result.error.issues[0]?.message,
      })
    }

    const studentId = result.data.studentId;
    const courseId = result.data.courseId;
    if(user?.role === "STUDENT"){
      if(user.studentId !== studentId){
        return res.status(403).json({
            success: false,
            massege: "Forbidden access",
        })
      }
    }else if(user?.role != "ADMIN"){
      return res.status(403).json({
          success: false,
          massege: "Forbidden access",
      })
    }

    const student = await prisma.enrollment.findMany({
      where: {studentId: studentId}
    })
    if(student.length === 0){
      return res.status(404).json({
        success: false,
        messege: `${studentId} hasn't registered for ${courseId}`,
      })
    }

    const course = student.find((c) => c.courseId === courseId);
    if(!course){
      return res.status(404).json({
        success: false,
        messege: `${courseId} hasn't been registered `,
      })
    }

    const deleted = await prisma.enrollment.delete({
      where: {
        id: course.id
      }
    })

    return res.status(200).json({
      success: true,
      messege: `Enrollment ${studentId} has been deleted ${courseId} successfully`,
      data: deleted,
    })



  }catch(err){
    return res.status(500).json({
        success: false,
        message: "Somthing is wrong, please try again",
        error: err,
    });
  }
}) 

export default router;
