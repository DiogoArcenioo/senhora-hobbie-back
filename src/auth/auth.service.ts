import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { compare } from 'bcryptjs';
import { JwtService } from '@nestjs/jwt';
import { ILike, Repository } from 'typeorm';
import { Usuario } from '../usuarios/entities/usuario.entity';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario)
    private readonly usuariosRepository: Repository<Usuario>,
    private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const email = loginDto.email.trim();

    const usuario = await this.usuariosRepository.findOne({
      where: { email: ILike(email) },
    });

    if (!usuario || !usuario.senha_hash || !usuario.ativo) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const senhaValida = await this.validarSenha(
      loginDto.senha,
      usuario.senha_hash,
    );

    if (!senhaValida) {
      throw new UnauthorizedException('Credenciais invalidas');
    }

    const payload = {
      sub: usuario.id,
      email: usuario.email,
      tipo: usuario.tipo,
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
      token_type: 'Bearer',
      user: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        tipo: usuario.tipo,
      },
    };
  }

  private async validarSenha(
    senhaInformada: string,
    senhaHash: string,
  ): Promise<boolean> {
    if (this.isBcryptHash(senhaHash)) {
      return compare(senhaInformada, senhaHash);
    }

    return senhaInformada === senhaHash;
  }

  private isBcryptHash(senhaHash: string): boolean {
    return (
      senhaHash.startsWith('$2a$') ||
      senhaHash.startsWith('$2b$') ||
      senhaHash.startsWith('$2y$')
    );
  }
}
